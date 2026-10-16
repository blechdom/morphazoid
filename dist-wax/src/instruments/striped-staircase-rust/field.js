import {
  CAMERA_SCALE_LIMITS, STRIPED_STAIRCASE_DEFAULTS, cameraFromView,
  createStaircaseFrame, normalizeStaircaseSettings,
} from '../striped-staircase/striped-staircase.js';

export const STAIRCASE_FIELD_FRAMES = 64;
export const STAIRCASE_BRANCH_LIMIT = 512;
export const STAIRCASE_DEFAULT_VOICES = 256;
export const STAIRCASE_BRANCH_OFFSET = 544;
export const STAIRCASE_BRANCH_STRIDE = 6;
export const STAIRCASE_FEATURE_STRIDE = 6;
export const STAIRCASE_FEATURE_FRAME_STRIDE = STAIRCASE_BRANCH_LIMIT * STAIRCASE_FEATURE_STRIDE;
export const STAIRCASE_FIELD_STRIDE = STAIRCASE_BRANCH_OFFSET + STAIRCASE_BRANCH_LIMIT * STAIRCASE_BRANCH_STRIDE;
export const STAIRCASE_CONTOUR_SAMPLES = 256;
export const STAIRCASE_FIELD_METADATA = Object.freeze({
  mass: 528, perimeter: 529, centroidX: 530, centroidY: 531, valid: 532, roughness: 533,
  threshold: 534, stripePeriod: 535, paired: 536,
});

const bounded = (value, fallback, low, high) => {
  const number = Number(value);
  return Math.min(high, Math.max(low, Number.isFinite(number) ? number : fallback));
};
const distance = (a, b, aspect) => Math.hypot((b.x - a.x) * aspect, b.y - a.y);
// Conservative tracking tolerance, not a theorem about fractal motion. Treat
// movement beyond this fraction of viewport height as unsupported continuity;
// start a new identity instead of connecting unmeasured space.
const EDGE_CONTINUITY_RADIUS = .15;

/** The original staircase's smooth escape formula, with NaN retained for
 * unescaped samples instead of pretending their depth equals the iteration cap.
 * This is a numerical display reading, not a claim about the Mandelbrot boundary.
 */
function escapeDepth(real, imaginary, limit) {
  let x = 0, y = 0;
  for (let iteration = 0; iteration < limit; iteration++) {
    const xx = x * x, yy = y * y;
    y = 2 * x * y + imaginary;
    x = xx - yy + real;
    const squared = x * x + y * y;
    if (squared > 256) {
      return iteration + 1 - Math.log(Math.max(.000001, .5 * Math.log(squared))) / Math.log(2);
    }
  }
  return NaN;
}

function sampleDepths(camera, settings, aspect, resolution) {
  const columns = Math.round(bounded(resolution, 128, 32, 192));
  const rows = Math.round(bounded(columns / aspect, 80, 24, 144));
  const depth = new Float64Array(columns * rows);
  let escaped = 0;
  for (let row = 0; row < rows; row++) {
    const imaginary = camera.centerY + (1 - 2 * row / (rows - 1)) * camera.scale;
    for (let column = 0; column < columns; column++) {
      const real = camera.centerX + (2 * column / (columns - 1) - 1) * aspect * camera.scale;
      const value = escapeDepth(real, imaginary, Math.ceil(settings.maxIterations));
      depth[row * columns + column] = value;
      if (Number.isFinite(value)) escaped++;
    }
  }
  return { columns, rows, depth, escaped };
}

/** Marching squares over known escaped samples only. A cell touching a censored
 * sample is omitted: it cannot establish where a contour crosses that cell.
 * Shared integer edge IDs join paths without rounding geometric positions.
 */
export function staircaseFieldContours(field, threshold, aspect = 1) {
  const { columns, rows, depth } = field;
  const vertices = new Map(), segments = [], adjacency = new Map();
  const verticalBase = rows * (columns - 1);
  function connect(a, b) {
    const index = segments.length;
    segments.push([a, b]);
    for (const key of [a, b]) {
      if (!adjacency.has(key)) adjacency.set(key, []);
      adjacency.get(key).push(index);
    }
  }
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const top = row * columns + column;
      const values = [depth[top], depth[top + 1], depth[top + columns + 1], depth[top + columns]];
      if (!values.every(Number.isFinite)) continue;
      const coordinates = [[column, row], [column + 1, row], [column + 1, row + 1], [column, row + 1]];
      const keys = [row * (columns - 1) + column, verticalBase + row * columns + column + 1,
        (row + 1) * (columns - 1) + column, verticalBase + row * columns + column];
      const hits = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        if ((values[edge] < threshold) === (values[next] < threshold)) continue;
        const key = keys[edge];
        if (!vertices.has(key)) {
          const mix = (threshold - values[edge]) / (values[next] - values[edge]);
          vertices.set(key, {
            x: (coordinates[edge][0] + (coordinates[next][0] - coordinates[edge][0]) * mix) / (columns - 1),
            y: (coordinates[edge][1] + (coordinates[next][1] - coordinates[edge][1]) * mix) / (rows - 1),
          });
        }
        hits.push(key);
      }
      if (hits.length === 2) connect(hits[0], hits[1]);
      else if (hits.length === 4) {
        // Resolve the ambiguous saddle using its bilinear center value.
        const centerLow = (values[0] + values[1] + values[2] + values[3]) / 4 < threshold;
        if (centerLow === (values[0] < threshold)) {
          connect(hits[0], hits[1]); connect(hits[2], hits[3]);
        } else { connect(hits[0], hits[3]); connect(hits[1], hits[2]); }
      }
    }
  }
  const used = new Uint8Array(segments.length), paths = [];
  function walk(start, first) {
    const points = [vertices.get(start)];
    let key = start, segmentIndex = first;
    while (segmentIndex !== undefined && !used[segmentIndex]) {
      used[segmentIndex] = 1;
      const segment = segments[segmentIndex];
      key = segment[0] === key ? segment[1] : segment[0];
      points.push(vertices.get(key));
      segmentIndex = adjacency.get(key).find(index => !used[index]);
    }
    if (points.length < 3) return;
    let length = 0;
    for (let index = 1; index < points.length; index++) length += distance(points[index - 1], points[index], aspect);
    if (length > 1e-9) paths.push({ points, closed: key === start, length });
  }
  // Start open paths at real ends; otherwise the same contour could be split
  // merely because its first encountered segment was in its middle.
  for (const [key, neighbors] of adjacency) if (neighbors.length === 1 && !used[neighbors[0]]) walk(key, neighbors[0]);
  for (let index = 0; index < segments.length; index++) if (!used[index]) walk(segments[index][0], index);
  return paths.sort((left, right) => right.length - left.length);
}

function canonicalPath(path) {
  let points = path.points.slice();
  if (!path.closed) {
    const first = points[0], last = points.at(-1);
    if (last.y < first.y || (last.y === first.y && last.x < first.x)) points.reverse();
    return points;
  }
  points.pop();
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) points.reverse();
  let start = 0;
  for (let index = 1; index < points.length; index++) {
    if (points[index].y < points[start].y || (points[index].y === points[start].y && points[index].x < points[start].x)) start = index;
  }
  points = points.slice(start).concat(points.slice(0, start));
  points.push(points[0]);
  return points;
}

function resampleContour(path, aspect, count = STAIRCASE_CONTOUR_SAMPLES) {
  const points = canonicalPath(path), cumulative = new Float64Array(points.length);
  for (let index = 1; index < points.length; index++) cumulative[index] = cumulative[index - 1] + distance(points[index - 1], points[index], aspect);
  const length = cumulative.at(-1), samples = new Float32Array(count * 2);
  for (let index = 0; index < count; index++) {
    const phase = index / count;
    // Open contours retrace their real path, avoiding a fictional closing edge.
    const target = length * (path.closed ? phase : phase <= .5 ? phase * 2 : (1 - phase) * 2);
    let low = 1, high = cumulative.length - 1;
    while (low < high) { const middle = (low + high) >>> 1; if (cumulative[middle] < target) low = middle + 1; else high = middle; }
    const a = points[low - 1], b = points[low];
    const mix = (target - cumulative[low - 1]) / Math.max(1e-12, cumulative[low] - cumulative[low - 1]);
    samples[index * 2] = a.x + (b.x - a.x) * mix;
    samples[index * 2 + 1] = a.y + (b.y - a.y) * mix;
  }
  return samples;
}

/** Match measured components between adjacent depths, with one slot per path.
 * This proximity heuristic preserves oscillator identity, not mathematical
 * ancestry: clipping, grid resolution and censored cells can also split paths.
 * Keep the longest components when a frame exceeds the selected voice budget.
 * IDs survive ordinary motion; an offshoot gets its own ID and a nearby parent
 * reference. This is a bounded geometric hypothesis, not proven spiral ancestry.
 * Paired mode opts into local anchor tracking; center mode retains its original
 * centroid/length assignment. Each side is subsequently checked by the pairer.
 */
export function matchStaircaseBranches(paths, previous = [], aspect = 1, options = {}) {
  const limit = Math.round(bounded(options.limit, STAIRCASE_BRANCH_LIMIT, 1, STAIRCASE_BRANCH_LIMIT));
  const identity = options.identity ?? { nextId: Math.max(0, ...previous.map(branch => branch.id ?? 0)) + 1 };
  const branches = paths.slice(0, limit).map(path => {
    const points = resampleContour(path, aspect, 64);
    let cx = 0, cy = 0;
    for (let index = 0; index < points.length; index += 2) { cx += points[index]; cy += points[index + 1]; }
    return { points, cx: cx / 64, cy: cy / 64, length: path.length, closed: path.closed, slot: -1, id: 0, parentId: 0 };
  });
  const candidates = [], followAnchor = options.followAnchor === true;
  for (let index = 0; index < branches.length; index++) for (const prior of previous) {
    const branch = branches[index];
    const movement = Math.hypot((branch.cx - prior.cx) * aspect, branch.cy - prior.cy);
    let cost;
    if (followAnchor) {
      // A component's centroid can move towards the wrong fragment at a split.
      // The heard cross-section, rather than the whole component, owns identity.
      const reference = prior.anchor ?? { x: prior.cx, y: prior.cy };
      const projected = contourAnchor(paths[index], reference, aspect);
      const localMovement = projected ? distance(reference, projected, aspect) : Infinity;
      if (localMovement > EDGE_CONTINUITY_RADIUS) continue;
      cost = localMovement + .0001 * movement;
    } else {
      if (movement > .3) continue;
      cost = movement + .025 * Math.abs(Math.log(branch.length / prior.length));
    }
    candidates.push({ branch, prior, cost });
  }
  candidates.sort((a, b) => a.cost - b.cost);
  const used = new Set();
  for (const { branch, prior } of candidates) {
    if (branch.slot < 0 && !used.has(prior.slot)) {
      branch.slot = prior.slot; branch.id = prior.id; branch.parentId = prior.parentId;
      used.add(prior.slot);
    }
  }
  for (const branch of branches) if (branch.slot < 0) {
    let slot = 0; while (used.has(slot)) slot++;
    branch.slot = slot; branch.id = identity.nextId++; used.add(slot);
    // A close centroid alone can join unrelated shapes. Require nearby sampled
    // outline points too before offering an inheritance link to the audio model.
    for (const candidate of candidates.filter(candidate => candidate.branch === branch)) {
      const prior = candidate.prior;
      let near = false;
      for (let a = 0; a < branch.points.length && !near; a += 8) for (let b = 0; b < prior.points.length; b += 8) {
        if (Math.hypot((branch.points[a] - prior.points[b]) * aspect, branch.points[a + 1] - prior.points[b + 1]) < .08) { near = true; break; }
      }
      if (near) { branch.parentId = prior.id; break; }
    }
  }
  return branches;
}

// Use raw marching-square segments here. The audio contour resampling retraces
// open paths, whose turnaround would give an artificial zero tangent.
function contourAnchor(path, previous, aspect, target = path.length / 2) {
  let best = null, closest = Infinity, walked = 0;
  for (let index = 0; index < path.points.length - 1; index++) {
    const a = path.points[index], b = path.points[index + 1];
    const dx = (b.x - a.x) * aspect, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-12) continue;
    const mix = previous ? Math.max(0, Math.min(1,
      ((previous.x - a.x) * aspect * dx + (previous.y - a.y) * dy) / (length * length)))
      : Math.max(0, Math.min(1, (target - walked) / length));
    const point = { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix };
    const cost = previous ? distance(point, previous, aspect) : Math.abs(walked + mix * length - target);
    if (cost < closest) { closest = cost; best = { ...point, a, b, dx, dy, length, arc: walked + mix * length }; }
    walked += length;
  }
  return best;
}

const TAU = Math.PI * 2;
const wrappedAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Measure a local tangent and bend on the original polyline, in viewport-height
 * units. Open paths are never retraced/closed. Scalar-gradient orientation keeps
 * marching-square point order from introducing half-turn jumps. A local window
 * touching an open end is unsupported: that end may be viewport clipping or an
 * unknown cell. This measures contour orientation, not a centroid's trajectory.
 */
export function measureStaircaseContourFeature(path, point, aspect = 1, scalarField = null) {
  const empty = { x: point?.x ?? 0, y: point?.y ?? 0, angle: 0, curvature: 0, confidence: 0 };
  if (!path?.points?.length || !(path.length > 1e-8)) return empty;
  const anchor = contourAnchor(path, point, aspect);
  if (!anchor) return empty;
  const reach = Math.min(.025, path.length / 8);
  const at = arc => contourAnchor(path, null, aspect, path.closed
    ? ((arc % path.length) + path.length) % path.length : Math.max(0, Math.min(path.length, arc)));
  const before = at(anchor.arc - reach), after = at(anchor.arc + reach);
  if (!before || !after) return empty;
  let dx = (after.x - before.x) * aspect, dy = after.y - before.y;
  if (Math.hypot(dx, dy) < 1e-10) return empty;
  if (scalarField) {
    const normal = increasingNormal(scalarField, anchor, aspect, -Infinity, Infinity);
    if (!normal) return empty;
    if (dx * normal.y - dy * normal.x * aspect < 0) { dx = -dx; dy = -dy; }
  }
  const incoming = Math.atan2(anchor.y - before.y, (anchor.x - before.x) * aspect);
  const outgoing = Math.atan2(after.y - anchor.y, (after.x - anchor.x) * aspect);
  // Bend per physical arclength, with a soft bounded range; a radius of .05
  // viewport heights reaches one third, and sharper subspirals get brighter.
  const bend = Math.abs(wrappedAngle(outgoing - incoming)) / Math.max(1e-8, reach);
  const supported = path.closed || (anchor.arc > reach * 1.05 && path.length - anchor.arc > reach * 1.05);
  return { x: anchor.x, y: anchor.y, angle: Math.atan2(dy, dx), curvature: bend / (bend + 40),
    confidence: supported ? 1 : 0 };
}

function insideOutline(point, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function disjointOutlines(a, b) {
  if (a.some(point => insideOutline(point, b)) || b.some(point => insideOutline(point, a))) return false;
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    if (cross(a[i - 1], a[i], b[j - 1]) * cross(a[i - 1], a[i], b[j]) < 0
      && cross(b[j - 1], b[j], a[i - 1]) * cross(b[j - 1], b[j], a[i]) < 0) return false;
  }
  return true;
}

function outlineRadius(outline, aspect) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of outline ?? []) {
    minX = Math.min(minX, point.x * aspect); maxX = Math.max(maxX, point.x * aspect);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  return Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) / 2 : .1;
}

function containsOutline(outer, inner) {
  if (!outer?.length || !inner?.length) return false;
  // Use actual vertices, not resampled oscillator loops or bounding boxes.
  return inner.every(point => insideOutline(point, outer));
}

/** Offline-only sidecar. IDs and slots are the unchanged audio table's IDs and
 * slots. Turns accumulate supported, oriented local-tangent changes; absolute
 * turning drives accents. Coarse/ambiguous jumps are held instead of guessing
 * how many revolutions happened between measured depths. Forks require two
 * persistent, disjoint closed components inside a formerly connected contour;
 * the baseline proximity parent hint alone is deliberately insufficient.
 */
export function buildStaircaseSpiralFeatures(frames, aspect = 1) {
  const features = new Float32Array(frames.length * STAIRCASE_FEATURE_FRAME_STRIDE);
  let previous = new Map();
  const history = new Map();
  for (let index = 0; index < frames.length; index++) {
    const records = frames[index], current = new Map(), next = new Map((frames[index + 1] ?? []).map(item => [item.id, item]));
    for (const record of records) {
      const prior = history.get(record.id), measurement = record.measurement;
      let confidence = bounded(measurement?.confidence, 0, 0, 1);
      if (![measurement?.angle, measurement?.x, measurement?.y, measurement?.curvature].every(Number.isFinite)) confidence = 0;
      const angle = bounded(measurement?.angle, 0, -Math.PI, Math.PI);
      const x = bounded(measurement?.x, 0, 0, 1), y = bounded(measurement?.y, 0, 0, 1);
      const delta = prior ? wrappedAngle(angle - prior.angle) : 0;
      const movement = prior ? Math.hypot((x - prior.x) * aspect, y - prior.y) : 0;
      const reach = Math.min(.2, Math.max(.02, outlineRadius(record.outline, aspect), outlineRadius(prior?.record.outline, aspect)));
      if (prior && (Math.abs(delta) > Math.PI / 2 || movement > reach)) confidence = 0;
      const accepted = confidence > 0 && (!prior || (prior.measurementValid && prior.frame === index - 1));
      const state = { record, x, y, angle, frame: index, measurementValid: confidence > 0,
        signedTurns: bounded((prior?.signedTurns ?? 0) + (accepted ? delta / TAU : 0), 0, -1024, 1024),
        travelTurns: bounded((prior?.travelTurns ?? 0) + (accepted ? Math.abs(delta) / TAU : 0), 0, 0, 2048),
        forkOffset: prior?.forkOffset ?? 0, fork: prior?.fork ?? null,
        curvature: confidence ? bounded(measurement.curvature, 0, 0, 1) : prior?.curvature ?? 0,
        confidence };
      if (state.fork && prior && accepted) {
        const origin = state.fork;
        state.forkOffset = bounded(state.forkOffset + ((x - prior.x) * aspect * -Math.sin(origin.angle)
          + (y - prior.y) * Math.cos(origin.angle)) / origin.scale, 0, -16, 16);
      }
      current.set(record.id, state);
    }
    for (const record of records) {
      if (history.has(record.id) || !record.parentId) continue;
      const child = current.get(record.id), parent = current.get(record.parentId), oldParent = previous.get(record.parentId);
      const futureChild = next.get(record.id), futureParent = next.get(record.parentId);
      if (!child?.confidence || !parent?.confidence || !oldParent?.confidence
        || !record.forkSafe || !parent.record.forkSafe || !oldParent.record.forkSafe
        || !futureChild?.forkSafe || !futureParent?.forkSafe
        || !containsOutline(oldParent.record.outline, record.outline)
        || !containsOutline(oldParent.record.outline, parent.record.outline)
        || !disjointOutlines(record.outline, parent.record.outline)) continue;
      // Inherit the parent's current phase at birth. Each child then measures
      // its own transverse movement from this fork, with no pitch jump at birth.
      child.signedTurns = parent.signedTurns; child.travelTurns = parent.travelTurns;
      child.forkOffset = parent.forkOffset;
      // Normalize separation to the local parent's radius, so a small deep
      // subspiral remains audible without substituting frame-wide motion.
      const scale = Math.max(.01, outlineRadius(oldParent.record.outline, aspect));
      for (const branch of [parent, child]) branch.fork = {
        angle: oldParent.angle, scale,
      };
    }
    for (const state of current.values()) {
      const { record } = state;
      history.set(record.id, state);
      if (record.mapped === false || !Number.isInteger(record.slot) || record.slot < 0 || record.slot >= STAIRCASE_BRANCH_LIMIT) continue;
      const offset = index * STAIRCASE_FEATURE_FRAME_STRIDE + record.slot * STAIRCASE_FEATURE_STRIDE;
      features.set([record.id, state.signedTurns, state.forkOffset, state.curvature, state.travelTurns, state.confidence], offset);
    }
    previous = current;
  }
  return features;
}

function forkEvidence(path) {
  return { outline: path.points, forkSafe: path.closed && path.points.every(point =>
    point.x > 1e-5 && point.x < 1 - 1e-5 && point.y > 1e-5 && point.y < 1 - 1e-5) };
}

function knownCell(field, column, row) {
  if (column < 0 || row < 0 || column >= field.columns - 1 || row >= field.rows - 1) return null;
  const at = row * field.columns + column;
  const values = [field.depth[at], field.depth[at + 1], field.depth[at + field.columns], field.depth[at + field.columns + 1]];
  return values.every(Number.isFinite) ? values : null;
}

function increasingNormal(field, anchor, aspect, low, high) {
  // A segment's midpoint identifies its own known cell even when the selected
  // anchor is exactly on a grid edge shared with a censored neighbor.
  const column = Math.min(field.columns - 2, Math.floor((anchor.a.x + anchor.b.x) / 2 * (field.columns - 1)));
  const row = Math.min(field.rows - 2, Math.floor((anchor.a.y + anchor.b.y) / 2 * (field.rows - 1)));
  const values = knownCell(field, column, row);
  if (!values) return null;
  const u = Math.max(0, Math.min(1, anchor.x * (field.columns - 1) - column));
  const v = Math.max(0, Math.min(1, anchor.y * (field.rows - 1) - row));
  const scalar = (values[0] * (1 - u) + values[1] * u) * (1 - v)
    + (values[2] * (1 - u) + values[3] * u) * v;
  // Straight marching-square segments approximate a bilinear level curve. If
  // that approximation leaves the band, it cannot certify a cross-section.
  const insideBand = scalar > low && scalar < high;
  const gx = ((values[1] - values[0]) * (1 - v) + (values[3] - values[2]) * v) * (field.columns - 1) / aspect;
  const gy = ((values[2] - values[0]) * (1 - u) + (values[3] - values[1]) * u) * (field.rows - 1);
  let nx = -anchor.dy / anchor.length, ny = anchor.dx / anchor.length;
  const gradient = nx * gx + ny * gy;
  if (!Number.isFinite(gradient) || Math.abs(gradient) < 1e-12) return null;
  if (gradient < 0) { nx = -nx; ny = -ny; }
  return { x: nx / aspect, y: ny, insideBand };
}

function bandBoundaryIndex(field, lowPaths, highPaths) {
  const columns = field.columns - 1, rows = field.rows - 1;
  const cells = new Map();
  for (const [boundary, paths] of [['low', lowPaths], ['high', highPaths]]) for (const path of paths) {
    for (let index = 0; index < path.points.length - 1; index++) {
      const a = path.points[index], b = path.points[index + 1];
      const segment = { a, b, boundary, path, index };
      // Include both cells at grid edges; ray traversal decides which known
      // cell is actually entered. These are tiny, local segment buckets.
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) * columns - 1e-8));
      const x1 = Math.min(columns - 1, Math.floor(Math.max(a.x, b.x) * columns + 1e-8));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) * rows - 1e-8));
      const y1 = Math.min(rows - 1, Math.floor(Math.max(a.y, b.y) * rows + 1e-8));
      for (let row = y0; row <= y1; row++) for (let column = x0; column <= x1; column++) {
        const key = row * columns + column;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(segment);
      }
    }
  }
  return cells;
}

function firstBandBoundary(field, cells, anchor, direction, expected) {
  const columns = field.columns - 1, rows = field.rows - 1, epsilon = 1e-10;
  let entered = 0;
  // A straight ray visits at most columns + rows cells. Unknown cells and the
  // viewport end the search: a farther visible loop cannot repair a missing side.
  for (let step = 0; step <= columns + rows; step++) {
    const column = Math.floor((anchor.x + direction.x * (entered + epsilon)) * columns);
    const row = Math.floor((anchor.y + direction.y * (entered + epsilon)) * rows);
    if (!knownCell(field, column, row)) return null;
    const tx = Math.abs(direction.x) < 1e-14 ? Infinity
      : ((column + (direction.x > 0 ? 1 : 0)) / columns - anchor.x) / direction.x;
    const ty = Math.abs(direction.y) < 1e-14 ? Infinity
      : ((row + (direction.y > 0 ? 1 : 0)) / rows - anchor.y) / direction.y;
    const exit = Math.min(tx, ty);
    let first = null, nearest = Infinity;
    for (const segment of cells.get(row * columns + column) ?? []) {
      const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
      const determinant = direction.x * dy - direction.y * dx;
      if (Math.abs(determinant) < 1e-14) continue;
      const ax = segment.a.x - anchor.x, ay = segment.a.y - anchor.y;
      const time = (ax * dy - ay * dx) / determinant;
      const along = (ax * direction.y - ay * direction.x) / determinant;
      if (time <= epsilon || time < entered - epsilon || time > exit + epsilon || along < -epsilon || along > 1 + epsilon) continue;
      if (time < nearest) {
        nearest = time;
        first = { ...segment, x: anchor.x + direction.x * time, y: anchor.y + direction.y * time };
      }
    }
    if (first) return first.boundary === expected ? first : null;
    if (!Number.isFinite(exit) || exit <= entered) return null;
    entered = exit;
  }
  return null;
}

function boundaryTrace(hit) {
  const source = hit.path.points, count = hit.path.closed ? source.length - 1 : source.length;
  const points = [];
  for (let index = hit.index - 3; index <= hit.index + 4; index++) {
    if (index === hit.index + 1) points.push(hit.x, hit.y);
    if (!hit.path.closed && (index < 0 || index >= count)) continue;
    const point = source[(index % count + count) % count];
    points.push(point.x, point.y);
  }
  return new Float32Array(points);
}

/** Follow a local cross-section of each measured band, not its centroid or box.
 * The anchor stays on the middle contour, projected from its prior/parent
 * anchor. Its aspect-correct normal must meet the low and high outlines first
 * on opposite sides, through known cells only. A failed pair emits no voices.
 * Side numbers are assigned by screen X once, then retain their low/high role
 * through bends and the existing approximate component-parent links.
 * Mutated tendrils carry only small plain anchor/order metadata to the next frame.
 */
export function pairStaircaseBlockEdges(field, tendrils, paths, low, high, aspect = 1, previous = [], featureMeasurements = null, continuity = null) {
  if (!(high > low) || !tendrils.length) return [];
  const lowPaths = staircaseFieldContours(field, low, aspect), highPaths = staircaseFieldContours(field, high, aspect);
  const cells = bandBoundaryIndex(field, lowPaths, highPaths);
  const ancestors = new Map(previous.map(branch => [branch.id, branch]));
  const voices = [];
  for (let index = 0; index < tendrils.length; index++) {
    const tendril = tendrils[index];
    const continuation = ancestors.get(tendril.id), parent = ancestors.get(tendril.parentId);
    const prior = continuation ?? parent;
    if (continuation?.edgePoints) tendril.edgePoints = continuation.edgePoints;
    let anchor = contourAnchor(paths[index], prior?.anchor, aspect);
    if (!anchor) continue;
    if (prior?.edgeOrder) tendril.edgeOrder = prior.edgeOrder;
    // If a parent has never established an orientation, no side-specific
    // inheritance is known. Keep that birth independent instead of later
    // inventing a link between opposite sides. A continuation keeps its choice.
    tendril.edgeParentId = continuation ? continuation.edgeParentId ?? 0 : parent?.edgeOrder ? parent.id : 0;
    const certify = candidate => {
      const normal = increasingNormal(field, candidate, aspect, low, high);
      if (!normal?.insideBand) return null;
      const lower = firstBandBoundary(field, cells, candidate, { x: -normal.x, y: -normal.y }, 'low');
      const upper = firstBandBoundary(field, cells, candidate, normal, 'high');
      return lower && upper ? { lower, upper, normal } : null;
    };
    let pair = certify(anchor);
    if (!pair) {
      // A carried anchor can land on a clipped endpoint while another nearby
      // cross-section on this very same contour is known. Search nearest-first
      // by arclength, at most a quarter contour / .2 viewport heights away,
      // with a fixed 24-candidate budget. Never hop to a neighboring contour.
      const path = paths[index], origin = anchor.arc, reach = Math.min(.2, path.length / 4);
      for (let step = 1; step <= 12 && !pair; step++) for (const sign of [-1, 1]) {
        let arc = origin + sign * reach * step / 12;
        if (path.closed) arc = (arc % path.length + path.length) % path.length;
        else if (arc < 0 || arc > path.length) continue;
        const candidate = contourAnchor(path, null, aspect, arc);
        const found = candidate && certify(candidate);
        if (found) { anchor = candidate; pair = found; break; }
      }
    }
    tendril.anchor = { x: anchor.x, y: anchor.y };
    const normal = pair?.normal ?? increasingNormal(field, anchor, aspect, low, high);
    if (!normal) continue;
    // Assign the orientation at birth even if a viewport/censoring gap prevents
    // this frame's pair. When it becomes audible later, its offspring must still
    // agree with the parent's original side identities.
    if (!tendril.edgeOrder) tendril.edgeOrder = normal.x > 0 || (normal.x === 0 && normal.y >= 0)
      ? ['low', 'high'] : ['high', 'low'];
    if (!pair) continue;
    const { lower, upper } = pair;
    if (continuity && continuation?.edgePoints
      && ['low', 'high'].some(boundary => distance(continuation.edgePoints[boundary],
        boundary === 'low' ? lower : upper, aspect) > EDGE_CONTINUITY_RADIUS)) {
      // Even a nearby middle contour may turn its normal toward a different
      // distant boundary. Retain low/high side roles, but never interpolate the
      // old pair into unverified distant points or inherit its pitch history.
      tendril.id = continuity.identity.nextId++;
      tendril.parentId = 0;
      tendril.edgeParentId = 0;
    }
    tendril.edgePoints = { low: { x: lower.x, y: lower.y }, high: { x: upper.x, y: upper.y } };
    for (let side = 0; side < 2; side++) {
      const boundary = tendril.edgeOrder[side], hit = boundary === 'low' ? lower : upper;
      const voice = { slot: tendril.slot * 2 + side, id: tendril.id * 2 - 1 + side,
        parentId: tendril.edgeParentId ? tendril.edgeParentId * 2 - 1 + side : 0,
        tendrilId: tendril.id, side, boundary, anchor: tendril.anchor,
        cx: hit.x, cy: hit.y, length: tendril.length / 2, weight: Math.min(1, tendril.length / 8) / 2,
        closed: false, points: boundaryTrace(hit) };
      voices.push(voice);
      featureMeasurements?.set(voice.id, { ...forkEvidence(paths[index]),
        measurement: measureStaircaseContourFeature(hit.path, hit, aspect, field) });
    }
  }
  return voices;
}

/** Read the same piecewise-linear depth data as Rust for visual feedback.
 * Traces use the nearest measured outline; their centroids, pitch and opacity
 * follow interpolated voice records. No display callback schedules a note.
 */
export function readStaircaseRhythm(field, progress) {
  const at = bounded(progress, 0, 0, 1) * (field.frames - 1);
  const low = Math.floor(at), high = Math.min(field.frames - 1, low + 1), mix = at - low;
  const read = index => field.table[low * field.stride + index] * (1 - mix) + field.table[high * field.stride + index] * mix;
  const nearest = field.overlays[Math.round(at)];
  const branches = [], traces = new Map();
  for (const overlay of [field.overlays[high], field.overlays[low], nearest]) for (const branch of overlay.branches) traces.set(branch.id, branch);
  for (let slot = 0; slot < STAIRCASE_BRANCH_LIMIT; slot++) {
    const index = STAIRCASE_BRANCH_OFFSET + slot * STAIRCASE_BRANCH_STRIDE;
    const a = low * field.stride + index, b = high * field.stride + index;
    const sameIdentity = field.table[a + 4] === field.table[b + 4];
    const selected = (mix < .5 ? low : high) * field.stride + index;
    const value = offset => sameIdentity ? read(index + offset) : field.table[selected + offset];
    const presence = value(0);
    if (presence <= .001) continue;
    const id = field.table[selected + 4], parentId = field.table[selected + 5];
    const trace = traces.get(id);
    let feature = { signedTurns: 0, forkOffset: 0, curvature: 0, travelTurns: 0, confidence: 0 };
    if (field.features?.length === field.frames * STAIRCASE_FEATURE_FRAME_STRIDE) {
      const fa = low * STAIRCASE_FEATURE_FRAME_STRIDE + slot * STAIRCASE_FEATURE_STRIDE;
      const fb = high * STAIRCASE_FEATURE_FRAME_STRIDE + slot * STAIRCASE_FEATURE_STRIDE;
      const selectedFeature = mix < .5 ? fa : fb;
      // Match Rust's supported interpolation. Unsupported records contain a
      // forward-depth geometric hold; playback may have approached from either
      // direction, so confidence zero deliberately does not claim its current
      // audible phase. The UI must not animate an unsupported measurement.
      const aligned = field.features[fa] === id && field.features[fb] === id
        && field.features[fa + 5] > 0 && field.features[fb + 5] > 0;
      const fv = offset => aligned ? field.features[fa + offset] * (1 - mix) + field.features[fb + offset] * mix
        : field.features[selectedFeature] === id ? field.features[selectedFeature + offset] : 0;
      feature = { signedTurns: fv(1), forkOffset: fv(2), curvature: fv(3), travelTurns: fv(4), confidence: fv(5) };
    }
    branches.push({ slot, id, parentId, presence, feature, cx: value(1), cy: value(2), length: value(3), points: trace?.points,
      ...(field.pitchSource === 1 ? { tendrilId: trace?.tendrilId, side: trace?.side,
        boundary: trace?.boundary, anchor: trace?.anchor } : {}) });
  }
  const width = (field.overlays[low].bandHigh - field.overlays[low].bandLow) * (1 - mix)
    + (field.overlays[high].bandHigh - field.overlays[high].bandLow) * mix;
  const threshold = read(534);
  const count = branches.filter(branch => branch.presence > .5).length;
  return { branches, count, tendrils: field.pitchSource === 1 ? count / 2 : count,
    pitchSource: field.pitchSource ?? 0, unpaired: nearest.unpaired ?? 0,
    omitted: nearest.omitted, threshold, bandLow: threshold - width / 2, bandHigh: threshold + width / 2,
    white: Math.floor(threshold / Math.max(.000001, read(535)) * 2) % 2 === 1 };
}

/** 64 original staircase slide frames, each with a 3616-float Rust ABI record:
 * 256 mean-centered contour x, 256 mean-centered contour y; 16 vertical band
 * density bins (sum 1); mass, perimeter/8, signed cx/cy, valid, turn roughness,
 * threshold mu, stripePeriod, paired-source flag; seven reserved zeros; 512 branch records containing
 * presence, screen cx/cy, length/8, integer ID and parent ID. Absent positions are held for smooth
 * fades, but presence is zero. Unescaped interior never creates a voice.
 */
export function buildStaircaseField(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const defaultCamera = cameraFromView();
  const camera = Object.fromEntries(['centerX', 'centerY', 'scale'].map(key => [key,
    bounded(source.camera?.[key], defaultCamera[key], key === 'scale' ? CAMERA_SCALE_LIMITS.minimum : -4,
      key === 'scale' ? CAMERA_SCALE_LIMITS.maximum : 4)]));
  const safeSettings = Object.fromEntries(Object.keys(STRIPED_STAIRCASE_DEFAULTS).filter(key => typeof STRIPED_STAIRCASE_DEFAULTS[key] === 'number')
    .map(key => [key, bounded(source.settings?.[key], STRIPED_STAIRCASE_DEFAULTS[key], -1e6, 1e6)]));
  const settings = normalizeStaircaseSettings(safeSettings);
  const aspect = bounded(source.aspect, 1.5, .25, 4);
  const pitchSource = Number(source.pitchSource) === 1 ? 1 : 0;
  const requestedVoices = Math.round(bounded(source.voiceLimit, STAIRCASE_DEFAULT_VOICES, pitchSource ? 2 : 1, STAIRCASE_BRANCH_LIMIT));
  const voiceLimit = pitchSource ? Math.floor(requestedVoices / 2) * 2 : requestedVoices;
  // Certify pairs before spending the oscillator budget. A long clipped middle
  // contour must not hide a shorter complete pair when only two tones are chosen.
  const tendrilLimit = pitchSource ? STAIRCASE_BRANCH_LIMIT / 2 : voiceLimit;
  const field = sampleDepths(camera, settings, aspect, source.resolution);
  const table = new Float32Array(STAIRCASE_FIELD_FRAMES * STAIRCASE_FIELD_STRIDE), overlays = [], featureGeometry = [];
  let activeFrames = 0, maxContours = 0, previousBranches = [];
  const identity = { nextId: 1 };
  for (let index = 0; index < STAIRCASE_FIELD_FRAMES; index++) {
    const frame = createStaircaseFrame(index / (STAIRCASE_FIELD_FRAMES - 1), settings, 'slide');
    const threshold = (frame.renderLow + frame.renderHigh) / 2;
    const offset = index * STAIRCASE_FIELD_STRIDE;
    table[offset + 534] = threshold;
    table[offset + 535] = settings.stripePeriod;
    table[offset + 536] = pitchSource;
    const paths = staircaseFieldContours(field, threshold, aspect);
    const tendrils = matchStaircaseBranches(paths, previousBranches, aspect, { limit: tendrilLimit, identity, followAnchor: Boolean(pitchSource) });
    const featureMeasurements = new Map();
    const paired = pitchSource ? pairStaircaseBlockEdges(field, tendrils, paths, frame.renderLow, frame.renderHigh, aspect, previousBranches, featureMeasurements, { identity }) : tendrils;
    if (!pitchSource) for (let pathIndex = 0; pathIndex < tendrils.length; pathIndex++) {
      const branch = tendrils[pathIndex], prior = previousBranches.find(item => item.id === branch.id);
      const measurement = measureStaircaseContourFeature(paths[pathIndex], prior?.featureAnchor, aspect, field);
      branch.featureAnchor = { x: measurement.x, y: measurement.y };
      featureMeasurements.set(branch.id, { ...forkEvidence(paths[pathIndex]), measurement });
    }
    const branches = paired.slice(0, voiceLimit);
    const mapped = new Set(branches.map(branch => branch.id));
    featureGeometry.push(paired.map(branch => ({ id: branch.id, parentId: branch.parentId, slot: branch.slot,
      mapped: mapped.has(branch.id), ...featureMeasurements.get(branch.id) })));
    previousBranches = tendrils;
    for (const branch of branches) table.set([1, branch.cx, branch.cy, branch.weight ?? Math.min(1, branch.length / 8), branch.id, branch.parentId],
      offset + STAIRCASE_BRANCH_OFFSET + branch.slot * STAIRCASE_BRANCH_STRIDE);
    const path = paths[0];
    const points = path ? resampleContour(path, aspect) : new Float32Array(0);
    overlays.push({ threshold, bandLow: frame.renderLow, bandHigh: frame.renderHigh,
      points, branches, tendrils: pitchSource ? branches.length / 2 : branches.length,
      unpaired: pitchSource ? tendrils.length - paired.length / 2 : 0,
      omitted: Math.max(0, paths.length - tendrils.length) + (pitchSource ? (paired.length - branches.length) / 2 : 0),
      closed: path?.closed ?? false, contours: paths.length, totalLength: paths.reduce((sum, item) => sum + item.length, 0) });
    maxContours = Math.max(maxContours, paths.length);
    if (!path) continue;
    activeFrames++;
    let cx = 0, cy = 0, turn = 0, mass = 0;
    const spectrum = new Float64Array(16);
    for (let sample = 0; sample < STAIRCASE_CONTOUR_SAMPLES; sample++) { cx += points[sample * 2]; cy += points[sample * 2 + 1]; }
    cx /= STAIRCASE_CONTOUR_SAMPLES; cy /= STAIRCASE_CONTOUR_SAMPLES;
    for (let sample = 0; sample < STAIRCASE_CONTOUR_SAMPLES; sample++) {
      table[offset + sample] = points[sample * 2] - cx;
      table[offset + STAIRCASE_CONTOUR_SAMPLES + sample] = cy - points[sample * 2 + 1];
      const previous = (sample + STAIRCASE_CONTOUR_SAMPLES - 1) % STAIRCASE_CONTOUR_SAMPLES;
      const next = (sample + 1) % STAIRCASE_CONTOUR_SAMPLES;
      const a = Math.atan2(points[sample * 2 + 1] - points[previous * 2 + 1], (points[sample * 2] - points[previous * 2]) * aspect);
      const b = Math.atan2(points[next * 2 + 1] - points[sample * 2 + 1], (points[next * 2] - points[sample * 2]) * aspect);
      turn += Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    }
    for (let cell = 0; cell < field.depth.length; cell++) {
      const depth = field.depth[cell];
      if (Number.isFinite(depth) && depth >= frame.renderLow && depth < frame.renderHigh) {
        mass++;
        const row = Math.floor(cell / field.columns);
        spectrum[Math.min(15, Math.floor((1 - row / (field.rows - 1)) * 16))]++;
      }
    }
    if (mass) for (let bin = 0; bin < 16; bin++) table[offset + 512 + bin] = spectrum[bin] / mass;
    table[offset + 528] = mass / field.depth.length;
    table[offset + 529] = Math.min(1, path.length / 8);
    table[offset + 530] = cx * 2 - 1;
    table[offset + 531] = 1 - cy * 2;
    table[offset + 532] = 1;
    table[offset + 533] = Math.min(1, Math.max(0, (turn / (Math.PI * 2) - 1) / 16));
  }
  // Interpolating from zero coordinates would sweep a newly appearing voice
  // across the screen/register. Carry the nearest measured position through
  // empty slots; the independent presence value still releases their sound.
  for (let slot = 0; slot < STAIRCASE_BRANCH_LIMIT; slot++) {
    const at = STAIRCASE_BRANCH_OFFSET + slot * STAIRCASE_BRANCH_STRIDE;
    const occupied = overlays.flatMap((_, index) => table[index * STAIRCASE_FIELD_STRIDE + at] ? [index] : []);
    for (let index = 0; index < STAIRCASE_FIELD_FRAMES && occupied.length; index++) {
      const offset = index * STAIRCASE_FIELD_STRIDE + at;
      if (table[offset]) continue;
      const nearest = occupied.reduce((best, candidate) => Math.abs(candidate - index) < Math.abs(best - index) ? candidate : best);
      const source = nearest * STAIRCASE_FIELD_STRIDE + at;
      table.set(table.subarray(source + 1, source + STAIRCASE_BRANCH_STRIDE), offset + 1);
    }
  }
  const features = buildStaircaseSpiralFeatures(featureGeometry, aspect);
  return { table, features, featureFrames: STAIRCASE_FIELD_FRAMES, featureStride: STAIRCASE_FEATURE_STRIDE,
    frames: STAIRCASE_FIELD_FRAMES, stride: STAIRCASE_FIELD_STRIDE, overlays, camera, settings, aspect, voiceLimit, pitchSource,
    stats: { columns: field.columns, rows: field.rows, samples: field.depth.length, escaped: field.escaped,
      censored: field.depth.length - field.escaped, activeFrames, maxContours } };
}
