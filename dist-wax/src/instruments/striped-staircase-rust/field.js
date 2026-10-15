import {
  CAMERA_SCALE_LIMITS, STRIPED_STAIRCASE_DEFAULTS, cameraFromView,
  createStaircaseFrame, normalizeStaircaseSettings,
} from '../striped-staircase/striped-staircase.js';

export const STAIRCASE_FIELD_FRAMES = 64;
export const STAIRCASE_FIELD_STRIDE = 544;
export const STAIRCASE_CONTOUR_SAMPLES = 256;
export const STAIRCASE_FIELD_METADATA = Object.freeze({
  mass: 528, perimeter: 529, centroidX: 530, centroidY: 531, valid: 532, roughness: 533,
  threshold: 534, stripePeriod: 535,
});

const bounded = (value, fallback, low, high) => {
  const number = Number(value);
  return Math.min(high, Math.max(low, Number.isFinite(number) ? number : fallback));
};
const distance = (a, b, aspect) => Math.hypot((b.x - a.x) * aspect, b.y - a.y);

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

function resampleContour(path, aspect) {
  const points = canonicalPath(path), cumulative = new Float64Array(points.length);
  for (let index = 1; index < points.length; index++) cumulative[index] = cumulative[index - 1] + distance(points[index - 1], points[index], aspect);
  const length = cumulative.at(-1), samples = new Float32Array(STAIRCASE_CONTOUR_SAMPLES * 2);
  for (let index = 0; index < STAIRCASE_CONTOUR_SAMPLES; index++) {
    const phase = index / STAIRCASE_CONTOUR_SAMPLES;
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

/** 64 original staircase slide frames, each with a 544-float Rust ABI record:
 * 256 mean-centered contour x, 256 mean-centered contour y; 16 vertical band
 * density bins (sum 1); mass, perimeter/8, signed cx/cy, valid, turn roughness,
 * threshold mu, stripePeriod; eight reserved zeros. Without a contour only
 * threshold/stripePeriod remain; the audio geometry and validity flag are zero.
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
  const field = sampleDepths(camera, settings, aspect, source.resolution);
  const table = new Float32Array(STAIRCASE_FIELD_FRAMES * STAIRCASE_FIELD_STRIDE), overlays = [];
  let activeFrames = 0, maxContours = 0;
  for (let index = 0; index < STAIRCASE_FIELD_FRAMES; index++) {
    const frame = createStaircaseFrame(index / (STAIRCASE_FIELD_FRAMES - 1), settings, 'slide');
    const threshold = (frame.renderLow + frame.renderHigh) / 2;
    const offset = index * STAIRCASE_FIELD_STRIDE;
    table[offset + 534] = threshold;
    table[offset + 535] = settings.stripePeriod;
    const paths = staircaseFieldContours(field, threshold, aspect);
    const path = paths[0];
    const points = path ? resampleContour(path, aspect) : new Float32Array(0);
    overlays.push({ threshold, bandLow: frame.renderLow, bandHigh: frame.renderHigh,
      points, closed: path?.closed ?? false, contours: paths.length, totalLength: paths.reduce((sum, item) => sum + item.length, 0) });
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
  return { table, frames: STAIRCASE_FIELD_FRAMES, stride: STAIRCASE_FIELD_STRIDE, overlays, camera, settings, aspect,
    stats: { columns: field.columns, rows: field.rows, samples: field.depth.length, escaped: field.escaped,
      censored: field.depth.length - field.escaped, activeFrames, maxContours } };
}
