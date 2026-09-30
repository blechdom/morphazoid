// Domino Run: deterministic routes, oriented-block contact, and a playable
// one-way fall approximation. Distances are scene units and times are seconds.
// The model does not solve stacking, rebounds, sliding or unlinked collisions.
// Density/loss are relative material controls, not measurements of a specimen.
// Contact includes bounded follow-through work from the falling predecessor:
// isolated impulses alone omit the continued pressure in a real domino train.
export const MATERIALS = Object.freeze([
  { id: 'stone', label: 'Stone', color: '#a6aca0', density: 2.6, loss: .26 },
  { id: 'wood', label: 'Wood', color: '#d49b61', density: .8, loss: .36 },
  { id: 'ceramic', label: 'Ceramic', color: '#ecb7aa', density: 2.3, loss: .19 },
  { id: 'glass', label: 'Glass', color: '#8adfd8', density: 2.5, loss: .12 },
  { id: 'metal', label: 'Metal', color: '#a8bde9', density: 3.8, loss: .14 },
  { id: 'plastic', label: 'Plastic', color: '#e79fe8', density: 1.1, loss: .30 },
].map(Object.freeze));
export const LAYOUTS = Object.freeze([
  { id: 'henge', label: 'Henge' }, { id: 'serpentine', label: 'Serpentine' },
  { id: 'spiral', label: 'Spiral' }, { id: 'fork', label: 'Bifurcations' },
  { id: 'stairs-up', label: 'Upstairs' }, { id: 'stairs-down', label: 'Downstairs' },
  { id: 'tapestry', label: 'Tapestry' },
].map(Object.freeze));
export const DEFAULT_PARAMS = Object.freeze({
  layout: 'henge', count: 40, spacing: .54, size: 1.12,
  sizeVariation: .10, growth: 0, stairRise: .09, material: 'stone',
  speed: 1, ring: .16, brightness: .43, loop: true, autoStand: false, standDelay: 1.5, seed: 1975,
});
const HALF_PI = Math.PI / 2, TAU = Math.PI * 2, G = 9.81;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const bounded = (v, lo, hi, fallback) => clamp(finite(v, fallback), lo, hi);
const materialFor = id => MATERIALS.find(m => m.id === id) || MATERIALS[0];
function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function sanitizeParams(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_PARAMS;
  return {
    layout: LAYOUTS.some(l => l.id === raw.layout) ? raw.layout : d.layout,
    count: Math.round(bounded(raw.count, 16, 512, d.count)),
    spacing: bounded(raw.spacing, .24, 1.35, d.spacing),
    size: bounded(raw.size, .65, 1.5, d.size),
    sizeVariation: bounded(raw.sizeVariation, 0, .4, d.sizeVariation),
    growth: bounded(raw.growth, -.5, .5, d.growth),
    stairRise: bounded(raw.stairRise, 0, .3, d.stairRise),
    material: raw.material === 'mixed' || MATERIALS.some(m => m.id === raw.material) ? raw.material : d.material,
    speed: bounded(raw.speed, .35, 2.4, d.speed),
    ring: bounded(raw.ring, 0, 1, d.ring),
    brightness: bounded(raw.brightness, .1, 1, d.brightness),
    loop: typeof raw.loop === 'boolean' ? raw.loop : d.loop,
    autoStand: typeof raw.autoStand === 'boolean' ? raw.autoStand : d.autoStand,
    standDelay: bounded(raw.standDelay, .1, 12, d.standDelay),
    seed: finite(raw.seed, d.seed) >>> 0,
  };
}
export function randomizeParams(seed = DEFAULT_PARAMS.seed) {
  const random = randomSource(finite(seed, DEFAULT_PARAMS.seed) >>> 0);
  const span = (a, b) => a + (b - a) * random();
  const layout = LAYOUTS[Math.floor(random() * LAYOUTS.length)].id;
  const materials = [...MATERIALS.map(m => m.id), 'mixed'];
  let params = sanitizeParams({
    layout, count: Math.round(layout === 'tapestry' ? span(128, 512) : span(24, 192)),
    spacing: span(.35, layout.startsWith('stairs') ? .67 : .78),
    size: span(.74, 1.4), sizeVariation: span(.015, .23), growth: span(-.38, .38),
    stairRise: span(.015, .16), material: materials[Math.floor(random() * materials.length)],
    speed: span(.5, 2.15), ring: .02 + .53 * random() ** 2, brightness: span(.12, .96),
    loop: random() < .75, autoStand: random() < .35, standDelay: span(.3, 5),
    seed: Math.floor(random() * 4294967296),
  });
  // Reject structural combinations that barely start. This keeps the dice
  // useful without suppressing failures when the player edits the controls.
  // Sound, speed, loop, material, seed and count survive structural repair.
  for (let attempt = 0; attempt < 8; attempt++) {
    if (compileRun(buildRun(params)).reachableCount >= params.count * .9) break;
    params = sanitizeParams({ ...params, spacing: params.spacing * .5 + .59 * .5,
      sizeVariation: params.sizeVariation * .7, growth: params.growth * .7,
      stairRise: params.stairRise * .85 });
  }
  return params;
}
const preset = (id, name, params) => Object.freeze({ id, name, params: Object.freeze(sanitizeParams({ ...DEFAULT_PARAMS, ...params })) });
export const PRESETS = Object.freeze([
  preset('tone-henge', 'Tone Henge', {}),
  preset('classic-plastic', 'Classic Plastic', { layout: 'serpentine', count: 64, material: 'plastic', spacing: .48, size: 1, sizeVariation: .025, ring: .08, brightness: .58, speed: 1.1, seed: 118 }),
  preset('ceramic-clatter', 'Ceramic Clatter', { layout: 'fork', count: 72, material: 'ceramic', spacing: .55, size: 1, sizeVariation: .05, ring: .12, brightness: .66, speed: .95, seed: 222 }),
  preset('stone-thuds', 'Stone Thuds', { layout: 'henge', count: 24, material: 'stone', spacing: .55, size: 1.4, sizeVariation: .06, ring: .05, brightness: .23, speed: .8, seed: 4096 }),
  preset('wooden-switchback', 'Wooden Switchback', { layout: 'serpentine', count: 64, material: 'wood', spacing: .46, size: 1, ring: .12, brightness: .56, seed: 114 }),
  preset('glass-coil', 'Glass Coil', { layout: 'spiral', count: 96, material: 'glass', spacing: .49, size: .8, sizeVariation: .16, ring: .5, brightness: .81, speed: 1.35, seed: 382 }),
  preset('porcelain-forks', 'Porcelain Forks', { layout: 'fork', count: 80, material: 'ceramic', spacing: .55, sizeVariation: .09, ring: .16, brightness: .62, seed: 819 }),
  preset('up-the-stairs', 'Up the Stairs', { layout: 'stairs-up', count: 40, material: 'wood', spacing: .53, size: 1.05, stairRise: .075, ring: .12, speed: .88, seed: 39 }),
  preset('down-the-stairs', 'Down the Stairs', { layout: 'stairs-down', count: 48, material: 'plastic', spacing: .61, stairRise: .12, ring: .05, brightness: .71, speed: 1.25, seed: 42 }),
  preset('woven-metal', 'Woven Metal', { layout: 'tapestry', count: 256, material: 'metal', spacing: .5, size: .85, sizeVariation: .07, ring: .48, brightness: .73, speed: .94, seed: 71 }),
  preset('material-tapestry', 'Material Tapestry', { layout: 'tapestry', count: 384, material: 'mixed', spacing: .58, sizeVariation: .1, ring: .18, brightness: .57, speed: 1.6, seed: 140 }),
  preset('growing-stones', 'Growing Stones', { layout: 'serpentine', count: 48, material: 'stone', spacing: .57, size: .9, growth: .48, ring: .12, speed: .72, seed: 923 }),
  preset('shrinking-glass', 'Shrinking Glass', { layout: 'spiral', count: 72, material: 'glass', spacing: .58, growth: -.45, ring: .44, brightness: .88, speed: 1.4, seed: 603 }),
  preset('loose-porcelain', 'Loose Porcelain', { layout: 'henge', count: 24, material: 'ceramic', spacing: .84, sizeVariation: .08, ring: .08, speed: .55, loop: false, seed: 187 }),
  preset('close-rattle', 'Close Rattle', { layout: 'serpentine', count: 112, material: 'plastic', spacing: .33, sizeVariation: .035, ring: .03, brightness: .75, speed: 1.95, seed: 406 }),
  preset('stone-weave', 'Stone Weave', { layout: 'tapestry', count: 512, material: 'stone', spacing: .53, size: .9, sizeVariation: .08, ring: .1, brightness: .35, speed: 1.25, seed: 718 }),
]);

export function buildRun(raw = {}) {
  const params = sanitizeParams(raw), p = params, random = randomSource(p.seed);
  const dominoes = [], links = [], base = 1.2 * p.size;
  const phase = random() * TAU;
  const depthLimit = p.layout === 'fork' ? Math.max(12, p.count * .45)
    : p.layout === 'tapestry' ? Math.sqrt(p.count) * 2.7 : p.count - 1;
  const mixed = ['wood', 'plastic', 'ceramic', 'glass', 'stone', 'metal'];
  function add(x, z, elevation = 0, angle = 0, parent = null, depth = 0) {
    const variation = Math.sin(depth * .46 + phase) * .65 + Math.sin(depth * .17 + phase * 2) * .35;
    let height = base * Math.exp(p.growth * (2 * depth / depthLimit - 1)) * (1 + variation * p.sizeVariation);
    if (parent) height = clamp(height, parent.height / 1.18, parent.height * 1.18);
    height = clamp(height, base * .45, base * 1.9);
    const material = materialFor(p.material === 'mixed' ? mixed[Math.floor(depth / 5) % mixed.length] : p.material);
    const d = { id: dominoes.length, x, z, elevation, height, width: height * .5, depth: height * .16,
      angle, material: material.id, color: material.color };
    dominoes.push(d);
    if (parent) links.push({ from: parent.id, to: d.id });
    return d;
  }
  const advance = (parent, angle, depth, lateral = 0, elevation = 0) => {
    const step = parent.height * p.spacing;
    return add(parent.x + Math.cos(parent.angle) * step - Math.sin(parent.angle) * lateral,
      parent.z + Math.sin(parent.angle) * step + Math.cos(parent.angle) * lateral,
      elevation, angle, parent, depth);
  };
  if (p.layout === 'henge') {
    // A circle uses the scene's mean size; individual size and spacing edits
    // can therefore leave a small stone unable to reach the next one.
    const radius = base * p.spacing / (2 * Math.sin(Math.PI / p.count));
    let parent = null;
    for (let i = 0; i < p.count; i++) {
      const a = i * TAU / p.count;
      const d = add(radius * Math.cos(a), radius * Math.sin(a), 0, a + HALF_PI + Math.PI / p.count, parent, i);
      parent = d;
    }
    links.push({ from: parent.id, to: dominoes[0].id });
  } else if (p.layout === 'spiral') {
    let parent = add(0, 0), angle = 0, radius = base * 1.5, polar = 0;
    parent.x = radius;
    for (let i = 1; i < p.count; i++) {
      const step = parent.height * p.spacing;
      const delta = step / Math.hypot(radius, base * .45);
      polar += delta; radius += base * .45 * delta;
      const x = radius * Math.cos(polar), z = radius * Math.sin(polar);
      angle = Math.atan2(z - parent.z, x - parent.x); parent.angle = angle;
      parent = add(x, z, 0, angle, parent, i);
    }
  } else if (p.layout === 'fork') {
    const root = add(0, 0);
    function branch(parent, remaining, depth, generation) {
      const segment = remaining < 12 || generation >= 3 ? remaining : Math.max(3, Math.ceil(Math.sqrt(remaining)));
      for (let i = 0; i < segment; i++) parent = advance(parent, parent.angle, depth++);
      remaining -= segment;
      if (!remaining) return;
      const leftCount = Math.floor(remaining / 2), rightCount = remaining - leftCount;
      for (const [sign, count] of [[-1, leftCount], [1, rightCount]]) {
        if (!count) continue;
        const child = advance(parent, parent.angle + sign * .52, depth, sign * parent.height * .29);
        branch(child, count - 1, depth + 1, generation + 1);
      }
    }
    branch(root, p.count - 1, 1, 0);
  } else if (p.layout === 'tapestry') {
    // A comb with real two-way contacts: every third spine tile launches a row.
    // The next spine tile and branch tile occupy opposite sides of its face.
    const rows = Math.max(2, Math.floor(Math.sqrt(p.count / 3)));
    const spineCount = rows * 3, spine = [add(0, 0, 0, HALF_PI)];
    for (let i = 1; i < spineCount; i++) {
      const parent = spine.at(-1), lateral = (i - 1) % 3 === 0 ? parent.height * .25 : 0;
      spine.push(advance(parent, HALF_PI, i, lateral));
    }
    const rowTotal = p.count - spineCount;
    for (let row = 0; row < rows; row++) {
      const count = Math.floor(rowTotal / rows) + (row < rowTotal % rows ? 1 : 0);
      let parent = spine[row * 3];
      for (let col = 0; col < count; col++) {
        const direction = col === 0 ? HALF_PI - .6 : col === 1 ? HALF_PI - 1.2 : 0;
        parent = advance(parent, direction, row * 3 + col + 1, col === 0 ? -parent.height * .30 : 0);
      }
    }
  } else {
    const stairs = p.layout.startsWith('stairs');
    const perTerrace = Math.ceil(p.count / 12), terraceCount = Math.floor((p.count - 1) / perTerrace);
    const columns = Math.max(5, Math.round(Math.sqrt(p.count) * 1.15));
    let parent = null, heading = 0, straight = 0, turn = 0, turnSign = 1;
    for (let i = 0; i < p.count; i++) {
      const level = Math.floor(i / perTerrace);
      const elevation = stairs ? (p.layout === 'stairs-up' ? level : terraceCount - level) * p.stairRise : 0;
      const d = parent ? advance(parent, heading, i, 0, elevation) : add(0, 0, elevation, heading);
      if (!stairs) {
        if (turn > 0) { heading += turnSign * Math.PI / 6; turn--; if (!turn) { straight = 0; turnSign *= -1; } }
        else if (++straight >= columns) { turn = 6; heading += turnSign * Math.PI / 6; turn--; }
        d.angle = heading;
      }
      parent = d;
    }
  }
  // Recenter without changing contacts; include the full fall reach in bounds.
  const xCenter = (Math.min(...dominoes.map(d => d.x)) + Math.max(...dominoes.map(d => d.x))) / 2;
  const zCenter = (Math.min(...dominoes.map(d => d.z)) + Math.max(...dominoes.map(d => d.z))) / 2;
  for (const d of dominoes) { d.x -= xCenter; d.z -= zCenter; }
  const minX = Math.min(...dominoes.map(d => d.x - d.height));
  const maxX = Math.max(...dominoes.map(d => d.x + d.height));
  const minZ = Math.min(...dominoes.map(d => d.z - d.height));
  const maxZ = Math.max(...dominoes.map(d => d.z + d.height));
  const minY = Math.min(...dominoes.map(d => d.elevation));
  const maxY = Math.max(...dominoes.map(d => d.elevation + d.height));
  return { params, dominoes, links, roots: [0], bounds: { minX, maxX, minZ, maxZ, minY, maxY,
    width: maxX - minX, depth: maxZ - minZ, height: maxY - minY } };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function box(d, angle = 0) {
  const c = Math.cos(d.angle), s = Math.sin(d.angle), co = Math.cos(angle), si = Math.sin(angle);
  const along = d.depth / 2 + d.height / 2 * si - d.depth / 2 * co;
  return { center: [d.x + c * along, d.elevation + d.height / 2 * co + d.depth / 2 * si, d.z + s * along],
    axes: [[c * co, -si, s * co], [c * si, co, s * si], [-s, 0, c]],
    half: [d.depth / 2, d.height / 2, d.width / 2] };
}
// Separating-axis test for the complete two oriented prisms (15 axes), including
// their vertical offset. The first overlap is refined in angle, not frame time.
function overlaps(a, b) {
  const r = a.axes.map(axis => b.axes.map(other => dot(axis, other)));
  const ar = r.map(row => row.map(value => Math.abs(value) + 1e-10));
  const delta = b.center.map((v, i) => v - a.center[i]);
  const t = a.axes.map(axis => dot(delta, axis)), ah = a.half, bh = b.half;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(t[i]) > ah[i] + bh[0] * ar[i][0] + bh[1] * ar[i][1] + bh[2] * ar[i][2]) return false;
    if (Math.abs(t[0] * r[0][i] + t[1] * r[1][i] + t[2] * r[2][i]) > bh[i] + ah[0] * ar[0][i] + ah[1] * ar[1][i] + ah[2] * ar[2][i]) return false;
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
    if (Math.abs(t[i2] * r[i1][j] - t[i1] * r[i2][j]) > ah[i1] * ar[i2][j] + ah[i2] * ar[i1][j] + bh[j1] * ar[i][j2] + bh[j2] * ar[i][j1]) return false;
  }
  return true;
}
export function contactGeometry(a, b) {
  const valid = d => d && ['x', 'z', 'elevation', 'height', 'width', 'depth', 'angle'].every(k => Number.isFinite(d[k])) && d.height > 0 && d.width > 0 && d.depth > 0;
  if (!valid(a) || !valid(b)) return { reachable: false, reason: 'invalid geometry' };
  const c = Math.cos(a.angle), s = Math.sin(a.angle), dx = b.x - a.x, dz = b.z - a.z;
  const forward = dx * c + dz * s, lateral = -dx * s + dz * c;
  const alignment = Math.cos(b.angle - a.angle);
  const targetWidth = Math.abs(Math.cos(b.angle - a.angle)) * b.width / 2 + Math.abs(Math.sin(b.angle - a.angle)) * b.depth / 2;
  const common = { distance: Math.hypot(dx, dz), alignment, gap: forward - (a.depth + b.depth) / 2 };
  if (forward <= 0) return { ...common, reachable: false, reason: 'behind fall' };
  if (Math.abs(lateral) > a.width / 2 + targetWidth) return { ...common, reachable: false, reason: 'sideways gap' };
  const target = box(b);
  if (overlaps(box(a), target)) return { ...common, reachable: false, reason: 'standing overlap' };
  let lo = 0, hi = 0, found = false;
  for (let step = 1; step <= 80; step++) {
    hi = step / 80 * HALF_PI;
    if (overlaps(box(a, hi), target)) { found = true; break; }
    lo = hi;
  }
  if (!found) return { ...common, reachable: false, reason: b.elevation > a.elevation ? 'step out of reach' : 'out of reach' };
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2;
    if (overlaps(box(a, mid), target)) hi = mid; else lo = mid;
  }
  const contactY = Math.min(b.elevation + b.height, a.elevation + a.height * Math.cos(hi) + a.depth * Math.sin(hi) / 2);
  return { ...common, reachable: true, angle: hi,
    contactHeight: clamp(contactY - b.elevation, 0, b.height),
    point: { x: b.x - Math.cos(b.angle) * b.depth / 2, y: contactY, z: b.z - Math.sin(b.angle) * b.depth / 2 } };
}

function barrier(d) { return (Math.hypot(d.height, d.depth) / d.height - 1) / 2 + .004; }
function fallRecord(d, start, kick) {
  const ratio = d.depth / d.height, loss = materialFor(d.material).loss, times = [0];
  const velocity = angle => Math.sqrt(Math.max(1e-7, 6 * G / d.height *
    (kick + .5 * (1 - Math.cos(angle)) - ratio / 2 * Math.sin(angle)) / (1 + ratio * ratio))) / (1 + loss * .18);
  const steps = 64, da = HALF_PI / steps;
  for (let i = 1; i <= steps; i++) times.push(times.at(-1) + da / velocity((i - .5) * da));
  return { id: d.id, start, duration: times.at(-1), times, kick };
}
function timeAtAngle(fall, angle) {
  const position = clamp(angle / HALF_PI, 0, 1) * (fall.times.length - 1);
  const i = Math.min(fall.times.length - 2, Math.floor(position)), f = position - i;
  return fall.start + fall.times[i] * (1 - f) + fall.times[i + 1] * f;
}
export function angleAt(fall, time) {
  if (!fall || !Number.isFinite(time)) return 0;
  if (time <= fall.start) return 0;
  if (Number.isFinite(fall.standStart) && time >= fall.standStart) {
    if (time >= fall.standEnd) return 0;
    const fraction = clamp((time - fall.standStart) / (fall.standEnd - fall.standStart), 0, 1);
    return HALF_PI * (1 - fraction * fraction * (3 - 2 * fraction));
  }
  if (time >= fall.start + fall.duration) return HALF_PI;
  const elapsed = time - fall.start;
  if (!Array.isArray(fall.times) || fall.times.length < 2) return HALF_PI * clamp(elapsed / fall.duration, 0, 1);
  let lo = 0, hi = fall.times.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fall.times[mid] <= elapsed) lo = mid; else hi = mid; }
  return HALF_PI * (lo + (elapsed - fall.times[lo]) / (fall.times[hi] - fall.times[lo])) / (fall.times.length - 1);
}
export function compileRun(run, { startIds = run.roots, force = 1 } = {}) {
  const dominoes = run.dominoes.slice(0, 512), byId = new Map(dominoes.map(d => [d.id, d]));
  const outgoing = new Map(), pending = [], scheduled = new Map(), falls = [], events = [], blockedLinks = [];
  const links = run.links.filter(link => byId.has(link.from) && byId.has(link.to)).slice(0, dominoes.length * 2);
  for (const link of links) {
    if (link.from === link.to) continue;
    if (!outgoing.has(link.from)) outgoing.set(link.from, []);
    if (!outgoing.get(link.from).some(l => l.to === link.to)) outgoing.get(link.from).push(link);
  }
  const enqueueFall = (id, time, kick) => {
    if (!byId.has(id) || scheduled.has(id) || kick < barrier(byId.get(id))) return;
    pending.push({ kind: 'fall', id, time, kick: clamp(kick, .001, .45) });
  };
  for (const id of new Set(Array.isArray(startIds) ? startIds : [])) enqueueFall(id, 0, bounded(force, 0, 3, 1) * .042);
  while (pending.length) {
    // Starts at a contact timestamp run before other contact batches at that
    // timestamp, so one standing target cannot absorb duplicate impulses.
    pending.sort((a, b) => a.time - b.time || (a.kind === 'fall' ? 0 : 1) - (b.kind === 'fall' ? 0 : 1) || a.id - b.id);
    const next = pending.shift(), d = byId.get(next.id), mat = materialFor(d.material);
    if (next.kind === 'fall') {
      if (scheduled.has(next.id)) continue;
      const fall = fallRecord(d, next.time, next.kick);
      scheduled.set(d.id, fall); falls.push(fall);
      events.push({ time: fall.start + fall.duration, type: 'floor', id: d.id, energy: clamp(Math.sqrt(next.kick + .5) * (1 - mat.loss * .35), .02, 1.5),
        material: d.material, height: d.height, x: d.x + Math.cos(d.angle) * d.height * .5, z: d.z + Math.sin(d.angle) * d.height * .5 });
      const contacts = [];
      for (const link of outgoing.get(d.id) || []) {
        const target = byId.get(link.to), geometry = contactGeometry(d, target);
        if (!geometry.reachable) { blockedLinks.push({ ...link, reason: geometry.reason }); continue; }
        contacts.push({ link, target, geometry, time: timeAtAngle(fall, geometry.angle) });
      }
      contacts.sort((a, b) => a.time - b.time || a.target.id - b.target.id);
      for (let i = 0; i < contacts.length;) {
        const time = contacts[i].time, group = [];
        while (i < contacts.length && contacts[i].time - time <= 1e-7) group.push(contacts[i++]);
        pending.push({ kind: 'contact', id: d.id, time, contacts: group, kick: next.kick });
      }
      continue;
    }
    // Only simultaneous physical contacts with standing targets share this
    // impulse. A missing route, an already moving target, or a later impact
    // must not retroactively take energy from the contact happening now.
    const contacts = next.contacts.filter(({ target }) => !scheduled.has(target.id));
    for (const { link, target, geometry } of contacts) {
      const time = next.time;
      const delta = .5 * (1 - Math.cos(geometry.angle)) - d.depth / d.height / 2 * Math.sin(geometry.angle);
      const impact = Math.max(0, next.kick + delta);
      events.push({ time, type: 'contact', id: d.id, targetId: target.id, energy: clamp(Math.sqrt(impact) * 1.8, .015, 1.5),
        material: d.material, height: d.height, x: geometry.point.x, z: geometry.point.z });
      const targetMat = materialFor(target.material);
      const massA = mat.density * d.height * d.width * d.depth;
      const massB = targetMat.density * target.height * target.width * target.depth;
      const collision = 4 * massA * massB / (massA + massB) ** 2;
      const loss = (mat.loss + targetMat.loss) / 2;
      const leverage = clamp(geometry.contactHeight / (target.height * .82), 0, 1) ** 2;
      const alignment = Math.max(0, geometry.alignment) ** 2;
      const followThrough = .065 * (1 - loss * .6) * (.3 + .7 * Math.sin(geometry.angle));
      const kick = (impact + followThrough) * (massA * d.height) / (massB * target.height) * collision * (1 - loss) * leverage * alignment / contacts.length;
      if (kick >= barrier(target)) enqueueFall(target.id, time, kick);
      else blockedLinks.push({ ...link, reason: 'insufficient transfer', time, angle: geometry.angle });
    }
  }
  events.sort((a, b) => a.time - b.time || a.id - b.id || (a.type === 'contact' ? -1 : 1));
  const duration = Math.max(0, ...falls.map(f => f.start + f.duration));
  return { events: events.slice(0, dominoes.length * 3), falls, duration,
    stalledIds: dominoes.filter(d => !scheduled.has(d.id)).map(d => d.id),
    reachableCount: falls.length, blockedLinks };
}

export const STAND_RISE_SECONDS = .4;
export const RUN_HISTORY_LIMITS = Object.freeze({ events: 16384, falls: 8192, transitionsPerAdvance: 32768 });

/**
 * Resumable, actual-second score for a fixed run/configuration snapshot.
 * Re-standing is a powered, deliberately fictional action; it supplies no
 * new falling impulse. Only a later contact or explicit trigger starts a fall.
 *
 * advance(until) emits only fresh records with event.time <= until. Falls can
 * extend beyond until; their floor impacts stay pending until a later advance.
 * A huge advance may return complete:false at its last processed timestamp;
 * call advance with the same deadline to resume without dropping queued work.
 * trigger must be at or after the already advanced simulation time. Changing
 * configuration or inserting a past gesture requires a new simulation.
 */
export function createRunSimulation(run, options = {}) {
  const params = sanitizeParams(run.params || {});
  const speed = bounded(options.speed, .35, 2.4, params.speed);
  const autoStand = typeof options.autoStand === 'boolean' ? options.autoStand : params.autoStand;
  const standDelay = bounded(options.standDelay, .1, 12, params.standDelay);
  const dominoes = run.dominoes.slice(0, 512).map(d => ({ ...d }));
  const byId = new Map(dominoes.map(d => [d.id, d])), routes = new Map();
  for (const link of run.links) {
    if (!byId.has(link.from) || !byId.has(link.to) || link.from === link.to) continue;
    const outgoing = routes.get(link.from) || [];
    if (outgoing.some(route => route.link.to === link.to)) continue;
    if (outgoing.length === 2) throw new RangeError('Domino Run supports at most two outgoing links per tile');
    const target = byId.get(link.to);
    outgoing.push({ link: { from: link.from, to: link.to }, target, geometry: contactGeometry(byId.get(link.from), target) });
    routes.set(link.from, outgoing);
  }
  const heap = [], events = [], falls = [], lastFalls = new Map(), seen = new Set(), blocked = new Map(), manualQueued = new Map();
  let time = 0, endTime = 0, serial = 0, occurrenceId = 0, eventId = 0;
  const priority = { ready: 0, fall: 1, contact: 2, floor: 3 };
  const compare = (a, b) => a.time - b.time || priority[a.kind] - priority[b.kind] || a.id - b.id || a.serial - b.serial;
  const push = item => {
    item.serial = ++serial;
    let index = heap.length; heap.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compare(heap[parent], item) <= 0) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = item;
  };
  const pop = () => {
    const first = heap[0], tail = heap.pop();
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child++;
        if (compare(tail, heap[child]) <= 0) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = tail;
    }
    return first;
  };
  const readyAt = id => lastFalls.get(id)?.standEnd ?? -Infinity;
  const isStanding = (id, at) => !lastFalls.has(id) || autoStand && at >= readyAt(id);
  const linkKey = link => `${link.from}:${link.to}`;
  const enqueueFall = (id, at, kick, manual = false) => {
    if (!byId.has(id) || !isStanding(id, at) || kick < barrier(byId.get(id))) return false;
    if (manual && manualQueued.has(id)) return false;
    const entry = { kind: 'fall', id, time: at, kick: clamp(kick, .001, .45), manual };
    if (manual) manualQueued.set(id, entry);
    push(entry); return true;
  };
  const trimHistory = () => {
    if (events.length > RUN_HISTORY_LIMITS.events) events.splice(0, events.length - RUN_HISTORY_LIMITS.events);
    if (falls.length > RUN_HISTORY_LIMITS.falls) {
      const keep = new Set(lastFalls.values());
      for (let i = falls.length - 1; i >= 0 && keep.size < RUN_HISTORY_LIMITS.falls; i--) keep.add(falls[i]);
      let write = 0;
      for (const fall of falls) if (keep.has(fall)) falls[write++] = fall;
      falls.length = write;
    }
  };
  const trigger = (ids, at = time, force = 1) => {
    if (!Number.isFinite(at) || at < time) return 0;
    let accepted = 0;
    const kick = bounded(force, 0, 3, 1) * .042;
    for (const id of new Set(Array.isArray(ids) ? ids : [ids])) if (enqueueFall(id, at, kick, true)) accepted++;
    return accepted;
  };
  const advance = until => {
    if (!Number.isFinite(until)) throw new RangeError('Domino Run advance requires a finite deadline');
    if (until < time) return { events: [], falls: [], complete: true, time, hasPending: !!heap.length, endTime };
    const freshEvents = [], freshFalls = [];
    const emit = event => {
      event.eventId = ++eventId;
      events.push(event); freshEvents.push(event);
    };
    let transitions = 0;
    while (heap.length && heap[0].time <= until && transitions < RUN_HISTORY_LIMITS.transitionsPerAdvance) {
      const next = pop(); transitions++; time = next.time;
      const d = byId.get(next.id), mat = materialFor(d.material);
      if (next.kind === 'ready') continue;
      if (next.kind === 'floor') { emit(next.event); continue; }
      if (next.kind === 'fall') {
        if (next.manual && manualQueued.get(next.id) === next) manualQueued.delete(next.id);
        if (!isStanding(next.id, next.time)) continue;
        const fall = fallRecord(d, next.time, next.kick);
        fall.times = fall.times.map(value => value / speed); fall.duration /= speed;
        fall.occurrenceId = ++occurrenceId;
        const landing = fall.start + fall.duration;
        fall.standStart = autoStand ? landing + standDelay : Infinity;
        fall.standEnd = autoStand ? fall.standStart + STAND_RISE_SECONDS : Infinity;
        lastFalls.set(d.id, fall); seen.add(d.id); falls.push(fall); freshFalls.push(fall);
        endTime = Math.max(endTime, autoStand ? fall.standEnd : landing);
        push({ kind: 'floor', id: d.id, time: landing, event: {
          time: landing, type: 'floor', id: d.id, occurrenceId: fall.occurrenceId,
          energy: clamp(Math.sqrt(next.kick + .5) * (1 - mat.loss * .35), .02, 1.5),
          material: d.material, height: d.height, x: d.x + Math.cos(d.angle) * d.height * .5, z: d.z + Math.sin(d.angle) * d.height * .5,
        } });
        if (autoStand) push({ kind: 'ready', id: d.id, time: fall.standEnd });
        const contacts = [];
        for (const route of routes.get(d.id) || []) {
          if (!route.geometry.reachable) {
            blocked.set(linkKey(route.link), { ...route.link, reason: route.geometry.reason, time });
            continue;
          }
          contacts.push({ ...route, time: timeAtAngle(fall, route.geometry.angle) });
        }
        contacts.sort((a, b) => a.time - b.time || a.target.id - b.target.id);
        for (let i = 0; i < contacts.length;) {
          const at = contacts[i].time, group = [];
          while (i < contacts.length && contacts[i].time - at <= 1e-7) group.push(contacts[i++]);
          push({ kind: 'contact', id: d.id, time: at, contacts: group, kick: next.kick, occurrenceId: fall.occurrenceId });
        }
        continue;
      }
      const contacts = next.contacts.filter(({ target, link }) => {
        if (isStanding(target.id, time)) return true;
        blocked.set(linkKey(link), { ...link, reason: 'not standing', time, readyAt: readyAt(target.id) });
        return false;
      });
      for (const { link, target, geometry } of contacts) {
        blocked.delete(linkKey(link));
        const delta = .5 * (1 - Math.cos(geometry.angle)) - d.depth / d.height / 2 * Math.sin(geometry.angle);
        const impact = Math.max(0, next.kick + delta);
        emit({ time, type: 'contact', id: d.id, targetId: target.id, occurrenceId: next.occurrenceId,
          energy: clamp(Math.sqrt(impact) * 1.8, .015, 1.5), material: d.material, height: d.height, x: geometry.point.x, z: geometry.point.z });
        const targetMat = materialFor(target.material);
        const massA = mat.density * d.height * d.width * d.depth;
        const massB = targetMat.density * target.height * target.width * target.depth;
        const collision = 4 * massA * massB / (massA + massB) ** 2;
        const loss = (mat.loss + targetMat.loss) / 2;
        const leverage = clamp(geometry.contactHeight / (target.height * .82), 0, 1) ** 2;
        const alignment = Math.max(0, geometry.alignment) ** 2;
        const followThrough = .065 * (1 - loss * .6) * (.3 + .7 * Math.sin(geometry.angle));
        const kick = (impact + followThrough) * (massA * d.height) / (massB * target.height) * collision * (1 - loss) * leverage * alignment / contacts.length;
        if (kick >= barrier(target)) enqueueFall(target.id, time, kick);
        else blocked.set(linkKey(link), { ...link, reason: 'insufficient transfer', time, angle: geometry.angle });
      }
    }
    const complete = !heap.length || heap[0].time > until;
    if (complete) time = Math.max(time, until);
    trimHistory();
    return { events: freshEvents, falls: freshFalls, complete, time, hasPending: !!heap.length, endTime };
  };
  const prune = before => {
    if (!Number.isFinite(before)) return;
    // Retain one pre-cutoff pose per tile, plus every future fall. In particular
    // pruning a 4-second lookahead must retain the pose at the audible present.
    const previous = new Map();
    for (const fall of falls) if (fall.start < before) previous.set(fall.id, fall);
    let write = 0;
    for (const fall of falls) if (fall.start >= before || previous.get(fall.id) === fall) falls[write++] = fall;
    falls.length = write;
    write = 0;
    for (const event of events) if (event.time >= before) events[write++] = event;
    events.length = write;
  };
  trigger(options.startIds ?? run.roots, 0, options.force ?? 1);
  return {
    advance, prune, trigger,
    get events() { return events; }, get falls() { return falls; },
    get time() { return time; }, get endTime() { return endTime; }, get duration() { return endTime; },
    get hasPending() { return heap.length > 0; }, get nextTime() { return heap[0]?.time ?? Infinity; },
    get pendingCount() { return heap.length; }, get reachableCount() { return seen.size; },
    get blockedLinks() { return [...blocked.values()]; }, get lastFalls() { return lastFalls; },
  };
}
