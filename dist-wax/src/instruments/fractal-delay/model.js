/** Finite vector routes made from quadratic complex dynamics.
 *
 * Complex-plane coordinates are divided by a FIXED 2.5, so adding detail never
 * rescales existing travel distances. Sound's waveguide/scattering law is an
 * interpretation of this geometry, not a theorem about complex dynamics.
 * Inverse construction: https://marksmath.org/scholarship/papers/Julia.pdf
 * Definitions: https://pi.math.cornell.edu/~klindsey/presentations/MandelbrotPresentation.pdf
 * Waveguide interpretation: https://ccrma.stanford.edu/~jos/pasp/Digital_Waveguide_Mesh.html
 */
import { MOTION_DEFAULTS, MOTION_LIMITS } from './parameter-motion.js';

export const MODES = Object.freeze([
  Object.freeze({ id: 'inverse', label: 'Inverse tree', description: 'Both square-root predecessors form a Julia vector tree.' }),
  Object.freeze({ id: 'contours', label: 'Contour loops', description: 'Numerical escape-potential contours connect at nearby spatial bridges.' }),
  Object.freeze({ id: 'orbits', label: 'Orbit routes', description: 'Numerical near-returns close critical orbits into approximate loops; finite nonperiodic routes remain open.' }),
  Object.freeze({ id: 'rays', label: 'Ray lattice', description: 'Numerical potential-gradient rays join surrounding equipotential loops.' }),
  Object.freeze({ id: 'membrane', label: 'Fractal chamber', description: 'A finite filled silhouette bounds a connected waveguide mesh.' }),
]);
export const PROPAGATION_MODES = Object.freeze([
  Object.freeze({ id: 'paths', label: 'Path echoes', description: 'Travelling delays connect geometric length, direction and turns to echoes.' }),
  Object.freeze({ id: 'resonance', label: 'Resonance', description: 'Bidirectional waveguides scatter through the graph as a resonant network.' }),
]);
export const INPUT_MODES = Object.freeze([
  Object.freeze({ id: 'point', label: 'Point', description: 'Inject at one position in the admitted graph.' }),
  Object.freeze({ id: 'cluster', label: 'Cluster', description: 'Inject into a local group around the input position.' }),
  Object.freeze({ id: 'distributed', label: 'Distributed', description: 'Spread independent injection ports across the graph.' }),
  Object.freeze({ id: 'boundary', label: 'Boundary', description: 'Excite terminal branches or sampled chamber boundary nodes.' }),
  Object.freeze({ id: 'all', label: 'All nodes', description: 'Inject into every admitted node with a shared energy budget.' }),
]);
export const PICKUP_MODES = Object.freeze([
  Object.freeze({ id: 'point', label: 'Point', description: 'Listen at one position in the admitted graph.' }),
  Object.freeze({ id: 'cluster', label: 'Cluster', description: 'Average a local group around the pickup position.' }),
  Object.freeze({ id: 'distributed', label: 'Distributed', description: 'Average receivers spread across the graph.' }),
  Object.freeze({ id: 'all', label: 'All nodes', description: 'Average the pressure at every admitted node.' }),
]);
export const ROUTING_MODES = Object.freeze([
  Object.freeze({ id: 'geometry', label: 'Geometry', description: 'Use the mathematical construction and its original spatial bridges.' }),
  Object.freeze({ id: 'loop', label: 'Return loop', description: 'Connect selected outer or terminal nodes into an additional return route.' }),
  Object.freeze({ id: 'shortcuts', label: 'Shortcuts', description: 'Add visible long-range connections between existing graph nodes.' }),
  Object.freeze({ id: 'hub', label: 'Hub', description: 'Connect selected graph nodes to an existing central junction.' }),
]);
export const DEFAULT_PARAMETERS = Object.freeze({ mode: 'inverse', domain: 'julia', propagation: 'paths', cReal: -.745, cImag: .113,
  ...MOTION_DEFAULTS,
  detail: 6, timeMs: 140, coupling: .82, decay: .84, pitchOffset: 0, pickup: .7,
  geometryPitch: 8, tapCoverage: .65, turnTone: .3,
  inputMode: 'point', inputPosition: 0, inputCount: 4, inputSpread: .5,
  pickupMode: 'point', pickupCount: 4, pickupSpread: .5, boundary: 1,
  routing: 'geometry', linkDensity: .25 });
export const PARAMETER_LIMITS = Object.freeze({ cReal: Object.freeze([-2, 1]), cImag: Object.freeze([-1.5, 1.5]),
  realMotionTempo: MOTION_LIMITS.tempo, imagMotionTempo: MOTION_LIMITS.tempo,
  realMotionDepth: MOTION_LIMITS.depth, imagMotionDepth: MOTION_LIMITS.depth,
  detail: Object.freeze([2, 12]), timeMs: Object.freeze([.05, 2000]), coupling: Object.freeze([0, 1]),
  decay: Object.freeze([0, 1]), pitchOffset: Object.freeze([-24, 24]), pickup: Object.freeze([0, 1]),
  geometryPitch: Object.freeze([0, 24]), tapCoverage: Object.freeze([0, 1]), turnTone: Object.freeze([0, 1]),
  inputPosition: Object.freeze([0, 1]), inputCount: Object.freeze([1, 256]), inputSpread: Object.freeze([0, 1]),
  pickupCount: Object.freeze([1, 256]), pickupSpread: Object.freeze([0, 1]), boundary: Object.freeze([0, 1]),
  linkDensity: Object.freeze([0, 1]) });
export const MAX_NETWORK_EDGES = 16384;
export const NO_DECAY_PARAMETERS = Object.freeze({ propagation: 'paths', decay: 1, coupling: 1,
  turnTone: 0, tapCoverage: 1, boundary: 1 });
export function hasNoDecay(parameters) {
  return Object.entries(NO_DECAY_PARAMETERS).every(([key, value]) => parameters[key] === value);
}
export const COMPLEX_COORDINATE_SCALE = 2.5;
const MAX_ITERATIONS = 96;
const TAU = 2 * Math.PI;
const MIN_LENGTH = .0001;
const ORBIT_RETURN_TOLERANCE = 1e-5;
const MODE_IDS = MODES.map(mode => mode.id);
export const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const numberOr = (value, fallback) => (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) ? Number(value) : fallback;

export function sanitizeParameters(candidate = {}) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const result = { mode: MODE_IDS.includes(source.mode) ? source.mode : DEFAULT_PARAMETERS.mode,
    domain: source.domain === 'mandelbrot' ? 'mandelbrot' : 'julia' };
  for (const [key, values] of [['propagation', PROPAGATION_MODES], ['inputMode', INPUT_MODES], ['pickupMode', PICKUP_MODES], ['routing', ROUTING_MODES]]) {
    result[key] = values.some(({ id }) => id === source[key]) ? source[key] : DEFAULT_PARAMETERS[key];
  }
  for (const [key, [low, high]] of Object.entries(PARAMETER_LIMITS)) result[key] = clamp(numberOr(source[key], DEFAULT_PARAMETERS[key]), low, high);
  result.detail = Math.round(result.detail);
  result.inputCount = Math.round(result.inputCount);
  result.pickupCount = Math.round(result.pickupCount);
  return result;
}

/** Pure complete-state randomizer; gains, input sources and transport are separate. */
export function randomizeParameters(candidate = DEFAULT_PARAMETERS, random = Math.random) {
  const unit = () => clamp(numberOr(random(), .5), 0, .999999999);
  // Consume a value for every musical field, including enums. No previous field
  // silently cages a new scene, and no output/device state enters this object.
  return sanitizeParameters({ mode: MODE_IDS[Math.floor(unit() * MODE_IDS.length)], domain: unit() < .7 ? 'julia' : 'mandelbrot',
    propagation: PROPAGATION_MODES[Math.floor(unit() * PROPAGATION_MODES.length)].id,
    cReal: -2 + 3 * unit(), cImag: -1.5 + 3 * unit(), detail: 2 + Math.floor(11 * unit()),
    realMotionTempo: .25 * 240 ** unit(), imagMotionTempo: .25 * 240 ** unit(),
    realMotionDepth: 1.5 * unit(), imagMotionDepth: 1.5 * unit(),
    timeMs: .05 * (2000 / .05) ** unit(), coupling: .3 + .7 * unit(), decay: .35 + .65 * unit(),
    pitchOffset: -24 + 48 * unit(), pickup: unit(),
    geometryPitch: 24 * unit(), tapCoverage: unit(), turnTone: unit(),
    inputMode: INPUT_MODES[Math.floor(unit() * INPUT_MODES.length)].id, inputPosition: unit(),
    inputCount: 1 + Math.floor(256 * unit()), inputSpread: unit(),
    pickupMode: PICKUP_MODES[Math.floor(unit() * PICKUP_MODES.length)].id,
    pickupCount: 1 + Math.floor(256 * unit()), pickupSpread: unit(), boundary: unit(),
    routing: ROUTING_MODES[Math.floor(unit() * ROUTING_MODES.length)].id, linkDensity: unit() });
}

/** Robust principal complex square root, including the negative real axis. */
export function complexSquareRoot(x, y) {
  const radius = Math.hypot(x, y);
  const real = Math.sqrt(Math.max(0, (radius + x) / 2));
  const imaginary = Math.sqrt(Math.max(0, (radius - x) / 2)) * (y < 0 ? -1 : 1);
  return { x: real, y: imaginary };
}

/** log2 of the Green/escape potential. Interior samples are a finite floor.
 * For Julia: G(z)=lim 2^-n log|f^n(z)|. For Mandelbrot, the critical orbit
 * supplies the parameter-plane potential, with a conventional index shift.
 * Contours are smooth FINITE numerical approximations, not exact boundaries.
 */
export function escapePotential(x, y, parameters = DEFAULT_PARAMETERS) {
  const p = parameters;
  const parameterPlane = p.domain === 'mandelbrot';
  const cr = parameterPlane ? x : p.cReal, ci = parameterPlane ? y : p.cImag;
  let zr = parameterPlane ? 0 : x, zi = parameterPlane ? 0 : y;
  let dr = parameterPlane ? 0 : 1, di = 0;
  for (let iteration = 0; iteration <= MAX_ITERATIONS; iteration++) {
    const radius = Math.hypot(zr, zi);
    if (radius >= 16) {
      const denominator = zr * zr + zi * zi;
      const gx = (dr * zr + di * zi) / denominator;
      const gy = (dr * zi - di * zr) / denominator;
      const norm = Math.hypot(gx, gy);
      return { value: Math.log2(Math.log(radius)) - iteration + (parameterPlane ? 1 : 0),
        dx: norm > 0 && Number.isFinite(norm) ? gx / norm : 0,
        dy: norm > 0 && Number.isFinite(norm) ? gy / norm : 0,
        escaped: true, iterations: iteration };
    }
    const nextDr = 2 * (zr * dr - zi * di) + (parameterPlane ? 1 : 0);
    di = 2 * (zr * di + zi * dr); dr = nextDr;
    const nextZr = zr * zr - zi * zi + cr;
    zi = 2 * zr * zi + ci; zr = nextZr;
  }
  return { value: -MAX_ITERATIONS, dx: 0, dy: 0, escaped: false, iterations: MAX_ITERATIONS };
}

// Stable unsigned IDs survive changes to c, time, pitch, loss and pickup.
function hashId(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}
function graphBuilder(mode) {
  const nodes = [], edges = [], nodeByKey = new Map(), nodeIds = new Set(), edgeIds = new Set();
  const uniqueId = (key, used) => { let id = hashId(`${mode}:${key}`); while (used.has(id)) id = (id + 1) >>> 0; used.add(id); return id; };
  return { nodes, edges,
    node(key, x, y, extra = {}) {
      if (nodeByKey.has(key)) return nodeByKey.get(key);
      const index = nodes.length;
      nodes.push({ id: uniqueId(key, nodeIds), x: x / COMPLEX_COORDINATE_SCALE, y: y / COMPLEX_COORDINATE_SCALE, ...extra });
      nodeByKey.set(key, index); return index;
    },
    edge(key, a, b, extra = {}) {
      if (a === b) return;
      const length = Math.max(MIN_LENGTH, Math.hypot(nodes[b].x - nodes[a].x, nodes[b].y - nodes[a].y));
      edges.push({ id: uniqueId(key, edgeIds), a, b, length, ...extra });
    },
  };
}
function inverseGraph(p, detail) {
  const graph = graphBuilder('inverse');
  graph.node('root', .731, .173, { generation: 0 });
  let parents = [{ index: 0, key: '', x: .731, y: .173 }];
  for (let generation = 1; generation <= detail; generation++) {
    const children = [];
    for (const parent of parents) {
      const root = complexSquareRoot(parent.x - p.cReal, parent.y - p.cImag);
      for (const sign of [1, -1]) {
        const key = `${parent.key}${sign === 1 ? '0' : '1'}`;
        const x = root.x * sign, y = root.y * sign;
        const index = graph.node(`point:${key}`, x, y, { generation });
        graph.edge(`route:${key}`, parent.index, index);
        children.push({ index, key, x, y });
      }
    }
    parents = children;
  }
  return { ...graph, metadata: { inverseDepth: detail, construction: 'w = ±sqrt(z − c)', endpointSet: 'finite Julia inverse iterates',
    domainMeaning: 'Mandelbrot coordinates select c; these routes always belong to the corresponding Julia system.' } };
}

function domainBox(p) {
  return p.domain === 'mandelbrot' ? { left: -3.1, right: 2.3, bottom: -2.7, top: 2.7 } : { left: -3, right: 3, bottom: -3, top: 3 };
}
function sampleField(p, resolution) {
  const box = domainBox(p), width = resolution + 1;
  const values = new Float64Array(width * width);
  for (let row = 0; row <= resolution; row++) for (let column = 0; column <= resolution; column++) {
    const x = box.left + (box.right - box.left) * column / resolution;
    const y = box.bottom + (box.top - box.bottom) * row / resolution;
    values[row * width + column] = escapePotential(x, y, p).value;
  }
  return { ...box, resolution, width, values };
}

/** Marching-squares contours, stitched into closed polylines. Ambiguous cells
 * use the sampled center (asymptotic-decider approximation), never a random
 * crossing. Open paths at the field boundary are not labeled closed loops.
 */
function extractContours(field, level, p) {
  const { resolution: n, width, values, left, right, bottom, top } = field;
  const points = new Map(), links = new Map();
  const xAt = column => left + (right - left) * column / n;
  const yAt = row => bottom + (top - bottom) * row / n;
  const connect = (a, b) => {
    if (!links.has(a)) links.set(a, []); if (!links.has(b)) links.set(b, []);
    links.get(a).push(b); links.get(b).push(a);
  };
  for (let row = 0; row < n; row++) for (let column = 0; column < n; column++) {
    const corners = [values[row * width + column], values[row * width + column + 1], values[(row + 1) * width + column + 1], values[(row + 1) * width + column]];
    const coordinates = [[xAt(column), yAt(row)], [xAt(column + 1), yAt(row)], [xAt(column + 1), yAt(row + 1)], [xAt(column), yAt(row + 1)]];
    const keys = [`h:${row}:${column}`, `v:${row}:${column + 1}`, `h:${row + 1}:${column}`, `v:${row}:${column}`];
    const crossings = [];
    for (let edge = 0; edge < 4; edge++) {
      const next = (edge + 1) % 4;
      if ((corners[edge] >= level) === (corners[next] >= level)) continue;
      const key = keys[edge];
      if (!points.has(key)) {
        // Interior's finite floor is not linearly interpolable with tiny escape
        // potentials. Refine against the actual scalar field so close contours
        // remain at their intended potential instead of clinging to grid edges.
        let low = 0, high = 1;
        for (let step = 0; step < 10; step++) {
          const fraction = (low + high) / 2;
          const x = coordinates[edge][0] + (coordinates[next][0] - coordinates[edge][0]) * fraction;
          const y = coordinates[edge][1] + (coordinates[next][1] - coordinates[edge][1]) * fraction;
          if ((escapePotential(x, y, p).value >= level) === (corners[edge] >= level)) low = fraction; else high = fraction;
        }
        const fraction = (low + high) / 2;
        points.set(key, { x: coordinates[edge][0] + (coordinates[next][0] - coordinates[edge][0]) * fraction,
          y: coordinates[edge][1] + (coordinates[next][1] - coordinates[edge][1]) * fraction });
      }
      crossings.push({ key, edge });
    }
    if (crossings.length === 2) connect(crossings[0].key, crossings[1].key);
    else if (crossings.length === 4) {
      const centerInside = escapePotential(xAt(column + .5), yAt(row + .5), p).value < level;
      const cornerInside = corners[0] < level;
      if (centerInside === cornerInside) { connect(crossings[0].key, crossings[1].key); connect(crossings[2].key, crossings[3].key); }
      else { connect(crossings[0].key, crossings[3].key); connect(crossings[1].key, crossings[2].key); }
    }
  }
  const visited = new Set(), loops = [];
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const route = []; let previous = '', current = start, closed = false;
    while (current && !visited.has(current)) {
      visited.add(current); route.push(points.get(current));
      const options = links.get(current) ?? [];
      const next = options.find(key => key !== previous);
      previous = current; current = next;
      if (current === start) { closed = true; break; }
    }
    if (closed && route.length >= 3) loops.push(route);
  }
  return loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
}
function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const next = points[(index + 1) % points.length]; area += points[index].x * next.y - points[index].y * next.x;
  }
  return area / 2;
}
function resample(points, count, closed = true) {
  const distances = [0], segments = closed ? points.length : points.length - 1;
  for (let index = 0; index < segments; index++) {
    const next = points[(index + 1) % points.length]; distances.push(distances.at(-1) + Math.hypot(next.x - points[index].x, next.y - points[index].y));
  }
  const total = distances.at(-1);
  if (!(total > 0)) return points.slice(0, 1);
  let segment = 0;
  return Array.from({ length: count }, (_, index) => {
    const distance = total * index / (closed ? count : count - 1);
    while (segment < segments - 1 && distances[segment + 1] < distance) segment++;
    const fraction = (distance - distances[segment]) / Math.max(1e-12, distances[segment + 1] - distances[segment]);
    const a = points[segment], b = points[(segment + 1) % points.length];
    return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
  });
}
const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
function nearestPair(graph, first, second, avoid = new Set()) {
  let distance = Infinity, result = null;
  for (const a of first) for (const b of second) {
    if (avoid.has(a) || avoid.has(b)) continue;
    const next = squaredDistance(graph.nodes[a], graph.nodes[b]);
    if (next < distance) { distance = next; result = { a, b }; }
  }
  return result;
}
function contourLoops(p, detail, mode = 'contours') {
  const graph = graphBuilder(mode), field = sampleField(p, 24 + detail * 5), groups = [];
  const levels = Array.from({ length: 2 + Math.floor(detail / 4) }, (_, index) => -.7 - index * 1.4);
  let omittedComponents = 0;
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
    const loops = extractContours(field, levels[levelIndex], p);
    // All coherent components above this finite sampling threshold participate.
    // Very small loops are unresolved at this grid; metadata records that fact.
    const useful = loops.filter(loop => Math.abs(polygonArea(loop)) > .002);
    omittedComponents += loops.length - useful.length;
    for (let component = 0; component < useful.length; component++) {
      const samples = resample(useful[component], Math.max(8, detail * 8));
      const indices = samples.map((point, index) => graph.node(`loop:${levelIndex}:${component}:${index}`, point.x, point.y, { contour: levelIndex }));
      for (let index = 0; index < indices.length; index++) graph.edge(`loop:${levelIndex}:${component}:${index}`, indices[index], indices[(index + 1) % indices.length]);
      groups.push({ indices, level: levels[levelIndex], levelIndex, component });
    }
  }
  // A spanning set of shortest spatial bridges makes one playable chamber.
  // These explicit chords are acoustic design, never claimed fractal boundary.
  const connected = new Set(groups.length ? [0] : []);
  while (connected.size < groups.length) {
    let choice = null, best = Infinity;
    for (const first of connected) for (let second = 0; second < groups.length; second++) {
      if (connected.has(second)) continue;
      const pair = nearestPair(graph, groups[first].indices, groups[second].indices);
      const distance = pair ? squaredDistance(graph.nodes[pair.a], graph.nodes[pair.b]) : Infinity;
      if (distance < best) { best = distance; choice = { first, second, pair }; }
    }
    if (!choice) break;
    graph.edge(`bridge:${choice.first}:${choice.second}`, choice.pair.a, choice.pair.b, { couplingLink: true });
    connected.add(choice.second);
  }
  return { ...graph, groups, metadata: { contourLevels: levels, closedLoops: groups.length, omittedUnresolvedComponents: omittedComponents,
    construction: 'finite marching-squares escape-potential loops with spatial coupling bridges', numericalApproximation: true } };
}

function orbitGraph(p, detail) {
  const graph = graphBuilder('orbits'), points = [{ x: 0, y: 0 }];
  let repeatAt = -1, escaped = false, nearReturnDistance = null;
  const steps = Math.max(8, detail * 8);
  for (let step = 0; step < steps; step++) {
    const last = points.at(-1), next = { x: last.x * last.x - last.y * last.y + p.cReal, y: 2 * last.x * last.y + p.cImag };
    if (Math.hypot(next.x, next.y) > 3.5 || !Number.isFinite(next.x + next.y)) { escaped = true; break; }
    // One complex-plane tolerance applies from the first step. An early
    // near-return is not retained as a duplicate merely because it is early.
    repeatAt = points.findIndex(point => Math.hypot(point.x - next.x, point.y - next.y) < ORBIT_RETURN_TOLERANCE);
    if (repeatAt >= 0) {
      nearReturnDistance = Math.hypot(points[repeatAt].x - next.x, points[repeatAt].y - next.y);
      break;
    }
    points.push(next);
  }
  // At a fixed critical point the exact orbit has zero travel distance. A local
  // perturbation route is displayed and labeled, rather than a fabricated cycle.
  let perturbedFixedPoint = false;
  if (points.length < 2) {
    perturbedFixedPoint = true;
    let last = { x: .18, y: .11 }; points.splice(0, points.length, last); repeatAt = -1;
    nearReturnDistance = null;
    for (let step = 0; step < Math.min(steps, 16); step++) {
      const next = { x: last.x * last.x - last.y * last.y + p.cReal, y: 2 * last.x * last.y + p.cImag };
      if (Math.hypot(next.x, next.y) > 3.5) break;
      points.push(next); last = next;
    }
  }
  const indices = points.map((point, index) => graph.node(`step:${index}`, point.x, point.y, { orbitStep: index }));
  for (let index = 1; index < indices.length; index++) graph.edge(`step:${index}`, indices[index - 1], indices[index]);
  if (repeatAt >= 0 && indices.length > 1) graph.edge(`return:${repeatAt}`, indices.at(-1), indices[repeatAt], { returnRoute: true });
  return { ...graph, metadata: { orbitSteps: points.length, repeatAt, period: repeatAt >= 0 ? points.length - repeatAt : 0,
    nearReturnTolerance: ORBIT_RETURN_TOLERANCE, nearReturnDistance, numericalApproximation: repeatAt >= 0,
    escaped, perturbedFixedPoint, construction: repeatAt >= 0 ? 'finite approximate near-return critical orbit' : 'finite forward orbit, open reflective end',
    domainMeaning: 'Mandelbrot coordinates select c; orbit routes show its Julia dynamics.' } };
}

function rayGraph(p, detail) {
  const contour = contourLoops(p, detail, 'rays'), graph = contour;
  const rayGroups = [], rayCount = Math.max(4, detail + 4), raySamples = Math.max(6, detail * 3 + 6);
  const centerX = p.domain === 'mandelbrot' ? -.5 : 0;
  for (let ray = 0; ray < rayCount; ray++) {
    const angle = ray / rayCount * TAU, points = [];
    let x = centerX + 2.65 * Math.cos(angle), y = 2.65 * Math.sin(angle);
    for (let step = 0; step < 180; step++) {
      const field = escapePotential(x, y, p); points.push({ x, y });
      if (!field.escaped || field.value < -5.8 || Math.hypot(field.dx, field.dy) < .1) break;
      const speed = clamp(.028 * 2 ** ((field.value + 1) / 3), .002, .06);
      x -= field.dx * speed; y -= field.dy * speed;
    }
    if (points.length < 2) continue;
    const samples = resample(points, raySamples, false);
    const indices = samples.map((point, index) => graph.node(`ray:${ray}:${index}`, point.x, point.y, { ray, rayStep: index }));
    for (let index = 1; index < indices.length; index++) graph.edge(`ray:${ray}:${index}`, indices[index - 1], indices[index]);
    // Finite marching samples and traced rays need not land on exactly the same
    // vertex. Show the tiny nearest-vertex bridge as an actual sounding edge.
    for (let group = 0; group < contour.groups.length; group++) {
      const pair = nearestPair(graph, indices, contour.groups[group].indices);
      if (pair && squaredDistance(graph.nodes[pair.a], graph.nodes[pair.b]) < .035) graph.edge(`ray-join:${ray}:${group}`, pair.a, pair.b, { couplingLink: true });
    }
    rayGroups.push(indices);
  }
  // If a disconnected component has no close intersection, one visible spatial
  // bridge connects it to the outer contour, preserving a playable full route.
  if (contour.groups.length) for (let ray = 0; ray < rayGroups.length; ray++) {
    const indices = rayGroups[ray];
    if (!graph.edges.some(edge => edge.couplingLink && (indices.includes(edge.a) || indices.includes(edge.b)))) {
      const pair = nearestPair(graph, indices, contour.groups[0].indices);
      if (pair) graph.edge(`ray-connect:${ray}`, pair.a, pair.b, { couplingLink: true });
    }
  }
  return { ...graph, metadata: { ...contour.metadata, rayCount: rayGroups.length,
    construction: 'numerical negative escape-potential gradient traces, equipotential loops and explicit spatial bridges',
    numericalApproximation: true, externalAngleClaim: false } };
}

function meshGraph(p, detail) {
  const graph = graphBuilder('membrane'), resolution = 4 + detail * 2, box = domainBox(p), cells = new Map();
  const spacing = (box.right - box.left) / resolution;
  const keyAt = (column, row) => `${column}:${row}`;
  const field = sampleField(p, resolution);
  let thickenedBoundary = false;
  const populate = threshold => {
    cells.clear();
    for (let row = 0; row <= resolution; row++) for (let column = 0; column <= resolution; column++) {
      if (field.values[row * field.width + column] < threshold) cells.set(keyAt(column, row), { column, row,
        x: box.left + spacing * column, y: box.bottom + (box.top - box.bottom) * row / resolution });
    }
  };
  populate(-MAX_ITERATIONS + 1);
  const components = () => {
    const seen = new Set(), result = [];
    for (const [key, cell] of cells) {
      if (seen.has(key)) continue;
      const component = [cell], pending = [cell]; seen.add(key);
      while (pending.length) {
        const point = pending.pop();
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nextKey = keyAt(point.column + dc, point.row + dr);
          if (cells.has(nextKey) && !seen.has(nextKey)) { seen.add(nextKey); const next = cells.get(nextKey); component.push(next); pending.push(next); }
        }
      }
      result.push(component);
    }
    return result.sort((a, b) => b.length - a.length);
  };
  let groups = components();
  if (!groups.length || groups[0].length < 4) {
    // Disconnected/dust-like Julia sets can have no resolvable filled interior.
    // An outer potential neighborhood provides an explicitly thickened chamber.
    thickenedBoundary = true; populate(-1.4); groups = components();
    if (!groups.length || groups[0].length < 2) { populate(-.25); groups = components(); }
  }
  const chosen = groups[0] ?? [], nodeIndices = new Map();
  for (const cell of chosen) nodeIndices.set(keyAt(cell.column, cell.row), graph.node(`cell:${cell.column}:${cell.row}`, cell.x, cell.y, { column: cell.column, row: cell.row }));
  for (const cell of chosen) for (const [dc, dr] of [[1, 0], [0, 1]]) {
    const a = nodeIndices.get(keyAt(cell.column, cell.row)), b = nodeIndices.get(keyAt(cell.column + dc, cell.row + dr));
    if (b !== undefined) graph.edge(`mesh:${cell.column}:${cell.row}:${dc}:${dr}`, a, b);
  }
  return { ...graph, metadata: { resolution, sampledFilledComponents: groups.length, retainedComponent: 'largest connected chamber',
    thickenedBoundary, construction: 'finite four-neighbor equal-impedance waveguide mesh', numericalApproximation: true } };
}

const BUILDERS = { inverse: inverseGraph, contours: contourLoops, orbits: orbitGraph, rays: rayGraph, membrane: meshGraph };
function nodeDegrees(graph) {
  const degrees = new Uint32Array(graph.nodes.length);
  for (const { a, b, routingLink } of graph.edges) if (!routingLink) { degrees[a]++; degrees[b]++; }
  return degrees;
}
function hullNodes(nodes) {
  const ordered = nodes.map((_, index) => index).sort((a, b) => nodes[a].x - nodes[b].x || nodes[a].y - nodes[b].y || nodes[a].id - nodes[b].id);
  if (ordered.length <= 2) return ordered;
  const turn = (a, b, c) => (nodes[b].x - nodes[a].x) * (nodes[c].y - nodes[a].y) - (nodes[b].y - nodes[a].y) * (nodes[c].x - nodes[a].x);
  const half = order => {
    const result = [];
    for (const index of order) { while (result.length >= 2 && turn(result.at(-2), result.at(-1), index) <= 0) result.pop(); result.push(index); }
    return result.slice(0, -1);
  };
  return [...new Set([...half(ordered), ...half([...ordered].reverse())])];
}
function boundaryNodes(graph) {
  const degrees = nodeDegrees(graph), terminals = graph.nodes.map((_, index) => index).filter(index => degrees[index] === 1);
  if (terminals.length >= 2) return terminals;
  if (graph.nodes.some(node => Number.isInteger(node.row))) {
    const perimeter = graph.nodes.map((_, index) => index).filter(index => degrees[index] < 4);
    if (perimeter.length) return perimeter;
  }
  return hullNodes(graph.nodes);
}
const pairKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

/** Optional acoustic routes are visible added edges, not fractal boundaries.
 * Candidate selection is deterministic; IDs follow the actual endpoint IDs.
 * The complete base + added graph is evaluated together by admission below.
 */
function addRouting(parameters, graph) {
  const baseEdges = graph.edges.length;
  if (parameters.routing === 'geometry' || parameters.linkDensity === 0 || graph.nodes.length < 3) {
    graph.metadata = { ...graph.metadata, routing: parameters.routing, routingEdges: 0 };
    return graph;
  }
  const nodes = graph.nodes, pairs = new Set(graph.edges.map(({ a, b }) => pairKey(a, b))), candidates = [];
  const candidate = (a, b) => {
    if (a === b || pairs.has(pairKey(a, b))) return;
    pairs.add(pairKey(a, b)); candidates.push({ a, b });
  };
  if (parameters.routing === 'loop') {
    const boundary = boundaryNodes(graph);
    const center = boundary.reduce((sum, index) => ({ x: sum.x + nodes[index].x / boundary.length, y: sum.y + nodes[index].y / boundary.length }), { x: 0, y: 0 });
    boundary.sort((a, b) => Math.atan2(nodes[a].y - center.y, nodes[a].x - center.x) - Math.atan2(nodes[b].y - center.y, nodes[b].x - center.x) || nodes[a].id - nodes[b].id);
    // Skip adjacent perimeter vertices: a contour already has those routes.
    // Every added chord closes a real return cycle through the connected base.
    // Fix the candidate set independently of density so raising density never
    // removes an existing connection on the same underlying geometry.
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    let stride = boundary.length < 4 ? 1 : Math.max(2, Math.floor(boundary.length * .38196601125));
    while (stride > 2 && gcd(stride, boundary.length) !== 1) stride--;
    for (let index = 0; index < boundary.length; index++) candidate(boundary[index], boundary[(index + stride) % boundary.length]);
  } else if (parameters.routing === 'hub') {
    const center = nodes.reduce((sum, node) => ({ x: sum.x + node.x / nodes.length, y: sum.y + node.y / nodes.length }), { x: 0, y: 0 });
    let hub = 0;
    for (let index = 1; index < nodes.length; index++) if (squaredDistance(nodes[index], center) < squaredDistance(nodes[hub], center)) hub = index;
    for (let index = 0; index < nodes.length; index++) candidate(hub, index);
  } else {
    const order = nodes.map((_, index) => index).sort((a, b) => nodes[a].id - nodes[b].id);
    const stride = Math.max(2, Math.floor(order.length * .38196601125));
    for (let index = 0; index < order.length; index++) candidate(order[index], order[(index + stride) % order.length]);
  }
  candidates.sort((a, b) => {
    const key = pair => `${Math.min(nodes[pair.a].id, nodes[pair.b].id)}:${Math.max(nodes[pair.a].id, nodes[pair.b].id)}`;
    return hashId(key(a)) - hashId(key(b)) || a.a - b.a || a.b - b.b;
  });
  const count = Math.ceil(candidates.length * parameters.linkDensity);
  const edgeIds = new Set(graph.edges.map(({ id }) => id));
  for (const { a, b } of candidates.slice(0, count)) {
    const endpoints = nodes[a].id < nodes[b].id ? `${nodes[a].id}:${nodes[b].id}` : `${nodes[b].id}:${nodes[a].id}`;
    let id = hashId(`${parameters.mode}:routing:${parameters.routing}:${endpoints}`);
    while (edgeIds.has(id)) id = (id + 1) >>> 0;
    edgeIds.add(id);
    graph.edges.push({ id, a, b, length: Math.max(MIN_LENGTH, Math.sqrt(squaredDistance(nodes[a], nodes[b]))),
      routingLink: true, routingType: parameters.routing });
  }
  graph.metadata = { ...graph.metadata, routing: parameters.routing, routingEdges: graph.edges.length - baseEdges,
    routingInterpretation: 'additional geometric acoustic connections; not claimed fractal boundary' };
  return graph;
}

function selectPorts(graph, mode, anchor, count, spread) {
  const nodes = graph.nodes;
  if (mode === 'point') return [anchor];
  let eligible = mode === 'boundary' ? boundaryNodes(graph) : nodes.map((_, index) => index);
  eligible.sort((a, b) => squaredDistance(nodes[a], nodes[anchor]) - squaredDistance(nodes[b], nodes[anchor]) || (b === anchor) - (a === anchor) || nodes[a].id - nodes[b].id);
  if (mode === 'all') return eligible;
  count = Math.min(count, eligible.length);
  const poolSize = Math.min(eligible.length, count + Math.round((eligible.length - count) * spread ** 2));
  eligible = eligible.slice(0, poolSize);
  if (mode === 'cluster' || count < 2) {
    return Array.from({ length: count }, (_, index) => eligible[count === 1 ? 0 : Math.round(index * (poolSize - 1) / (count - 1))]);
  }
  // Greedy farthest-point coverage avoids taking merely the first N generation
  // indices. Radius/spread restricts the candidate area; the anchor stays first.
  const selected = [eligible[0]], chosen = new Set(selected);
  const distance = eligible.map(index => squaredDistance(nodes[index], nodes[selected[0]]));
  while (selected.length < count) {
    let best = -1;
    for (let index = 0; index < eligible.length; index++) {
      if (!chosen.has(eligible[index]) && (best < 0 || distance[index] > distance[best])) best = index;
    }
    if (best < 0) break;
    const next = eligible[best]; selected.push(next); chosen.add(next);
    for (let index = 0; index < eligible.length; index++) distance[index] = Math.min(distance[index], squaredDistance(nodes[eligible[index]], nodes[next]));
  }
  return selected;
}

/** Ports address admitted nodes only. DSP injects weight/sqrt(node degree) into
 * each outgoing waveguide, so L2 source weights keep aggregate injection energy
 * at one rather than growing with node count. Receiver weights form a L1 mean.
 */
export function networkPorts(graph, candidate = graph.parameters ?? DEFAULT_PARAMETERS) {
  const parameters = sanitizeParameters(candidate), nodes = graph.nodes;
  let origin = 0;
  if (!['inverse', 'orbits'].includes(parameters.mode)) {
    const target = { x: parameters.cReal / COMPLEX_COORDINATE_SCALE, y: parameters.cImag / COMPLEX_COORDINATE_SCALE };
    for (let index = 1; index < nodes.length; index++) if (squaredDistance(nodes[index], target) < squaredDistance(nodes[origin], target)) origin = index;
  }
  // Position zero preserves the original root/c excitation. Follow the stable
  // construction order cyclically from that origin across the remaining range.
  const inputAnchor = (origin + Math.round(parameters.inputPosition * Math.max(0, nodes.length - 1))) % nodes.length;
  const pickupAnchor = Math.round(parameters.pickup * Math.max(0, nodes.length - 1));
  const input = selectPorts(graph, parameters.inputMode, inputAnchor, parameters.inputCount, parameters.inputSpread);
  const pickup = selectPorts(graph, parameters.pickupMode, pickupAnchor, parameters.pickupCount, parameters.pickupSpread);
  return { inputNode: input[0], pickupNode: pickup[0],
    inputPorts: input.map(node => ({ node, weight: 1 / Math.sqrt(input.length) })),
    pickupPorts: pickup.map(node => ({ node, weight: 1 / pickup.length })) };
}
function boundsOf(nodes) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const node of nodes) { minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x); minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y); }
  return nodes.length ? { minX, maxX, minY, maxY } : { minX: -.5, maxX: .5, minY: -.5, maxY: .5 };
}
function minimumRoute(p, graph) {
  if (graph.edges.length) {
    const edge = graph.edges[0], first = graph.nodes[edge.a], second = graph.nodes[edge.b];
    return { nodes: [{ ...first }, { ...second }], edges: [{ ...edge, a: 0, b: 1 }],
      metadata: { ...graph.metadata, coarseSingleRoute: true } };
  }
  const fallback = graphBuilder(p.mode), first = fallback.node('coarse:0', p.cReal - .05, p.cImag), second = fallback.node('coarse:1', p.cReal + .05, p.cImag);
  fallback.edge('coarse:route', first, second);
  return { ...fallback, metadata: { ...graph.metadata, coarseSingleRoute: true, unsupportedInteriorFallback: true,
    construction: 'visible coarse reflective route at selected c, no resolved chamber' } };
}

/** Build the complete playable graph before admission. Budget reduction uses
 * whole inverse generations / contour sampling / mesh resolution; it never
 * progressively publishes a growing prefix. requestedEdges measures the full
 * requested detail. Optional maxTotalLength supports two-way memory admission.
 */
export function buildNetwork(candidate = DEFAULT_PARAMETERS, budget = 512, options = {}) {
  const parameters = sanitizeParameters(candidate), limit = Math.floor(clamp(numberOr(budget, 512), 1, MAX_NETWORK_EDGES));
  const maxTotalLength = Math.max(MIN_LENGTH, numberOr(options?.maxTotalLength, Infinity));
  const builder = BUILDERS[parameters.mode];
  let detail = parameters.detail, graph = addRouting(parameters, builder(parameters, detail));
  const requestedEdges = graph.edges.length;
  const requestedRoutingEdges = graph.metadata.routingEdges;
  const requestedTotalLength = graph.edges.reduce((sum, edge) => sum + edge.length, 0);
  const fits = graph => graph.edges.length <= limit && graph.edges.reduce((sum, edge) => sum + edge.length, 0) <= maxTotalLength;
  while (!fits(graph) && detail > 1) { detail--; graph = addRouting(parameters, builder(parameters, detail)); }
  if (!fits(graph) || !graph.edges.length) graph = minimumRoute(parameters, graph);
  const nodes = graph.nodes, edges = graph.edges;
  const ports = networkPorts(graph, parameters);
  const totalLength = edges.reduce((sum, edge) => sum + edge.length, 0);
  return { mode: parameters.mode, domain: parameters.domain, parameters, nodes, edges, ...ports, requestedEdges,
    bounds: boundsOf(nodes), metadata: { ...graph.metadata, requestedDetail: parameters.detail, preparedDetail: detail,
      requestedRoutingEdges, routingEdges: edges.filter(edge => edge.routingLink).length,
      inputMode: parameters.inputMode, pickupMode: parameters.pickupMode, inputPortCount: ports.inputPorts.length,
      pickupPortCount: ports.pickupPorts.length, inputNormalization: 'L2 weights with DSP degree-normalized injection', pickupNormalization: 'L1 weighted pressure mean',
      requestedTotalLength, totalLength, budget: limit, budgetAdjusted: edges.length < requestedEdges,
      memoryAdjusted: requestedTotalLength > maxTotalLength, admissionUnsupported: totalLength > maxTotalLength, minimumLength: MIN_LENGTH,
      coordinateScale: COMPLEX_COORDINATE_SCALE, completeGraph: true } };
}
