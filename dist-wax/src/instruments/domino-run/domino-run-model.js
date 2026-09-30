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
  { id: 'wave', label: 'Wave' }, { id: 'zigzag', label: 'Zigzag' },
  { id: 'polygon', label: 'Polygon' }, { id: 'flower', label: 'Flower' },
  { id: 'figure-eight', label: 'Figure eight' }, { id: 'helix', label: 'Helix' },
].map(Object.freeze));
export const MAX_DOMINOES = 1024;
export const MIN_DOMINO_HEIGHT = .03, MAX_DOMINO_HEIGHT = 64;
export const DEFAULT_PARAMS = Object.freeze({
  layout: 'henge', count: 40, spacing: .54, size: 1.12,
  direction: 'forward', rotation: 0, stretch: 1, curvature: 1, pitch: 0,
  sizeVariation: .10, growth: 0, stairRise: .09, material: 'stone',
  speed: 1, ring: .16, brightness: .43, soundVariation: .2, loop: true, autoStand: false, standDelay: 1.5, seed: 1975,
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
    direction: raw.direction === 'reverse' ? 'reverse' : d.direction,
    rotation: bounded(raw.rotation, -180, 180, d.rotation),
    stretch: bounded(raw.stretch, .2, 5, d.stretch),
    curvature: bounded(raw.curvature, .2, 3, d.curvature),
    pitch: bounded(raw.pitch, -36, 36, d.pitch),
    count: Math.round(bounded(raw.count, 4, MAX_DOMINOES, d.count)),
    spacing: bounded(raw.spacing, .12, 2.5, d.spacing),
    size: bounded(raw.size, .1, 6, d.size),
    sizeVariation: bounded(raw.sizeVariation, 0, 1, d.sizeVariation),
    growth: bounded(raw.growth, -2, 2, d.growth),
    stairRise: bounded(raw.stairRise, -1, 1, d.stairRise),
    material: raw.material === 'mixed' || MATERIALS.some(m => m.id === raw.material) ? raw.material : d.material,
    speed: bounded(raw.speed, .05, 12, d.speed),
    ring: bounded(raw.ring, 0, 1, d.ring),
    brightness: bounded(raw.brightness, 0, 1, d.brightness),
    soundVariation: bounded(raw.soundVariation, 0, 1, d.soundVariation),
    loop: typeof raw.loop === 'boolean' ? raw.loop : d.loop,
    autoStand: typeof raw.autoStand === 'boolean' ? raw.autoStand : d.autoStand,
    standDelay: bounded(raw.standDelay, .05, 60, d.standDelay),
    seed: finite(raw.seed, d.seed) >>> 0,
  };
}
// Repeat controls belong to the live player, independently of scene recall.
export function sceneParams(raw = {}) {
  const { loop, autoStand, standDelay, ...scene } = sanitizeParams(raw);
  return scene;
}
export function randomizeParams(seed = DEFAULT_PARAMS.seed) {
  const random = randomSource(finite(seed, DEFAULT_PARAMS.seed) >>> 0);
  const span = (a, b) => a + (b - a) * random();
  const logSpan = (a, b) => Math.exp(span(Math.log(a), Math.log(b)));
  const layout = LAYOUTS[Math.floor(random() * LAYOUTS.length)].id;
  const materials = [...MATERIALS.map(m => m.id), 'mixed'];
  // Most throws form playable paths; wild throws deliberately explore gaps,
  // gradients and mass mismatches. Never repair the selected scene repeatedly.
  const wild = random() < .22, size = logSpan(.12, 5.5);
  return sanitizeParams({
    layout, count: Math.round(wild ? logSpan(4, MAX_DOMINOES) : logSpan(24, 640)),
    direction: random() < .5 ? 'forward' : 'reverse', rotation: span(-180, 180),
    stretch: wild ? logSpan(.2, 5) : logSpan(.88, 1.13),
    curvature: wild ? logSpan(.2, 3) : span(.8, 1.2),
    spacing: wild ? logSpan(.12, 2.5) : span(.46, .66),
    size, sizeVariation: wild ? span(.35, 1) : span(0, .12),
    growth: wild ? span(-2, 2) : span(-.35, .35),
    stairRise: wild ? span(-1, 1) : span(-.035, .055) * Math.min(size, 3),
    material: materials[Math.floor(random() * materials.length)],
    speed: logSpan(.05, 12), pitch: span(-36, 36),
    ring: random() ** 2, brightness: random(), soundVariation: random(),
    loop: random() < .75, autoStand: random() < .35, standDelay: logSpan(.05, 60),
    seed: Math.floor(random() * 4294967296),
  });
}

/** Shared generated/drawn law: progress is 0..1 and variation is -1..1. */
export function dominoHeight(base, progress, variation, params = {}) {
  const depth = bounded(progress, 0, 1, 0), wave = bounded(variation, -1, 1, 0);
  const amount = bounded(params.sizeVariation, 0, 1, DEFAULT_PARAMS.sizeVariation);
  const growth = bounded(params.growth, -2, 2, DEFAULT_PARAMS.growth);
  // Familiar low settings continue into four further octaves above the former
  // maximum. Log size remains positive and exactly uniform at zero variation.
  const logVariation = Math.log1p(wave * Math.min(amount, .4))
    + wave * Math.max(0, amount - .4) / .6 * Math.log(16);
  return clamp(finite(base, 1.2 * DEFAULT_PARAMS.size)
    * Math.exp(growth * (2 * depth - 1) + logVariation), MIN_DOMINO_HEIGHT, MAX_DOMINO_HEIGHT);
}

/** Transform fresh forward geometry once; drawings can retain their origin. */
export function applyRunTransform(run, { recenter = true } = {}) {
  const p = sanitizeParams(run.params), angle = p.rotation * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle), dominoes = run.dominoes;
  const byId = new Map(dominoes.map(d => [d.id, d]));
  for (const d of dominoes) {
    const x = d.x * p.stretch, z = d.z;
    d.x = x * c - z * s; d.z = x * s + z * c;
    d.angle = p.stretch === 1 ? d.angle + angle : Math.atan2(Math.sin(d.angle), Math.cos(d.angle) * p.stretch) + angle;
  }
  if (p.direction === 'reverse') {
    run.links = run.links.map(link => ({ ...link, from: link.to, to: link.from }));
    const outgoing = new Map(), incoming = new Map(), neighbors = new Map();
    for (const d of dominoes) { outgoing.set(d.id, []); incoming.set(d.id, []); neighbors.set(d.id, []); }
    for (const link of run.links) {
      if (!byId.has(link.from) || !byId.has(link.to)) continue;
      outgoing.get(link.from).push(byId.get(link.to)); incoming.get(link.to).push(byId.get(link.from));
      neighbors.get(link.from).push(link.to); neighbors.get(link.to).push(link.from);
    }
    for (const d of dominoes) {
      const next = outgoing.get(d.id), previous = incoming.get(d.id);
      const vectors = next.length ? next.map(to => [to.x - d.x, to.z - d.z])
        : previous.map(from => [d.x - from.x, d.z - from.z]);
      const vector = vectors.reduce((sum, v) => { const length = Math.hypot(...v) || 1; return [sum[0] + v[0] / length, sum[1] + v[1] / length]; }, [0, 0]);
      d.angle = Math.hypot(...vector) > 1e-10 ? Math.atan2(vector[1], vector[0]) : d.angle + Math.PI;
    }
    // Closed components retain one starter. Open components start at all
    // former terminal tiles, so reversed forks naturally converge.
    const visited = new Set(), roots = [];
    for (const d of dominoes) {
      if (visited.has(d.id)) continue;
      const component = [], queue = [d.id]; visited.add(d.id);
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i]; component.push(id);
        for (const neighbor of neighbors.get(id)) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
      const starters = component.filter(id => incoming.get(id).length === 0);
      roots.push(...(starters.length ? starters : [run.roots?.find(id => component.includes(id)) ?? component[0]]));
    }
    run.roots = roots;
  }
  if (recenter && dominoes.length) {
    const cx = (Math.min(...dominoes.map(d => d.x)) + Math.max(...dominoes.map(d => d.x))) / 2;
    const cz = (Math.min(...dominoes.map(d => d.z)) + Math.max(...dominoes.map(d => d.z))) / 2;
    for (const d of dominoes) { d.x -= cx; d.z -= cz; }
  }
  const min = values => values.length ? Math.min(...values) : 0;
  const max = values => values.length ? Math.max(...values) : 0;
  const minX = min(dominoes.map(d => d.x - d.height)), maxX = max(dominoes.map(d => d.x + d.height));
  const minZ = min(dominoes.map(d => d.z - d.height)), maxZ = max(dominoes.map(d => d.z + d.height));
  const minY = min(dominoes.map(d => d.elevation)), maxY = max(dominoes.map(d => d.elevation + d.height));
  run.bounds = { minX, maxX, minZ, maxZ, minY, maxY, width: maxX - minX, depth: maxZ - minZ, height: maxY - minY };
  return run;
}

const preset = (id, name, params) => Object.freeze({ id, name, params: Object.freeze(sanitizeParams({ ...DEFAULT_PARAMS, ...params })) });
export const PRESETS = Object.freeze([
  preset('tone-henge', 'Tone Henge', {}),
  preset('classic-plastic', 'Classic Plastic', { layout: 'serpentine', count: 64, material: 'plastic', spacing: .48, size: 1, sizeVariation: .025, ring: .08, brightness: .58, soundVariation: .14, speed: 1.1, seed: 118 }),
  preset('ceramic-clatter', 'Ceramic Clatter', { layout: 'fork', count: 72, material: 'ceramic', spacing: .55, size: 1, sizeVariation: .05, ring: .12, brightness: .66, soundVariation: .18, speed: .95, seed: 222 }),
  preset('stone-thuds', 'Stone Thuds', { layout: 'henge', count: 24, material: 'stone', spacing: .55, size: 1.4, sizeVariation: .06, ring: .05, brightness: .23, soundVariation: .3, speed: .8, seed: 4096 }),
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
  preset("ant-march", "Ant March", {"layout":"wave","count":128,"size":0.1,"spacing":0.52,"speed":4,"pitch":18,"material":"plastic","ring":0.02,"sizeVariation":0.04,"curvature":1.6,"seed":602}),
  preset("monolith-crawl", "Monolith Crawl", {"layout":"henge","count":12,"size":6,"spacing":0.56,"speed":0.05,"pitch":-24,"material":"stone","ring":0,"brightness":0.1,"sizeVariation":0,"seed":603}),
  preset("porcelain-petals", "Porcelain Petals", {"layout":"flower","count":192,"size":0.4,"spacing":0.5,"speed":3.5,"pitch":9,"material":"ceramic","ring":0.08,"sizeVariation":0.02,"curvature":1.8,"rotation":35,"seed":604}),
  preset("figure-eight-frenzy", "Figure Eight Frenzy", {"layout":"figure-eight","count":256,"size":0.3,"spacing":0.52,"speed":12,"pitch":12,"material":"plastic","ring":0.02,"sizeVariation":0,"direction":"reverse","seed":605}),
  preset("rising-coil", "Rising Coil", {"layout":"helix","count":128,"size":2.5,"spacing":0.52,"speed":1.5,"pitch":-12,"material":"stone","ring":0.04,"sizeVariation":0,"stairRise":0.5,"curvature":1.6,"seed":606}),
  preset("reverse-weave", "Reverse Weave", {"layout":"tapestry","count":512,"size":0.3,"spacing":0.5,"speed":5,"pitch":0,"material":"wood","ring":0.04,"sizeVariation":0,"direction":"reverse","rotation":-65,"seed":607}),
  preset("colossus-growth", "Colossus Growth", {"layout":"wave","count":128,"size":2,"spacing":0.5,"speed":0.3,"pitch":-18,"material":"stone","ring":0.02,"sizeVariation":0,"growth":2,"curvature":0.5,"seed":608}),
  preset("thousand-clacks", "Thousand Clacks", {"layout":"polygon","count":1024,"size":0.15,"spacing":0.5,"speed":8,"pitch":6,"material":"mixed","ring":0.05,"sizeVariation":0,"seed":609}),
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
    const height = dominoHeight(base, depth / Math.max(1, depthLimit), variation, p);
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
      const next = a + TAU / p.count;
      const heading = p.curvature === 1 ? a + HALF_PI + Math.PI / p.count
        : Math.atan2(p.curvature * (Math.sin(next) - Math.sin(a)), Math.cos(next) - Math.cos(a));
      const d = add(radius * Math.cos(a), radius * Math.sin(a) * p.curvature, 0, heading, parent, i);
      parent = d;
    }
    links.push({ from: parent.id, to: dominoes[0].id });
  } else if (p.layout === 'spiral') {
    let parent = add(0, 0), angle = 0, radius = base * 1.5 / p.curvature, polar = 0;
    parent.x = radius;
    for (let i = 1; i < p.count; i++) {
      const step = parent.height * p.spacing;
      const delta = step / Math.hypot(radius, base * .45 / p.curvature);
      polar += delta; radius += base * .45 / p.curvature * delta;
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
        const child = advance(parent, parent.angle + sign * .52 * p.curvature, depth, sign * parent.height * .29);
        branch(child, count - 1, depth + 1, generation + 1);
      }
    }
    branch(root, p.count - 1, 1, 0);
  } else if (p.layout === 'tapestry') {
    // A comb with real two-way contacts: every third spine tile launches a row.
    // The next spine tile and branch tile occupy opposite sides of its face.
    const rows = Math.max(1, Math.floor(Math.sqrt(p.count / 3)));
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
        const direction = col === 0 ? HALF_PI - .6 * p.curvature : col === 1 ? HALF_PI - 1.2 * p.curvature : HALF_PI * (1 - p.curvature);
        parent = advance(parent, direction, row * 3 + col + 1, col === 0 ? -parent.height * .30 : 0);
      }
    }
  } else if (['polygon', 'flower', 'figure-eight', 'helix'].includes(p.layout)) {
    buildCurve();
  } else if (p.layout === 'wave' || p.layout === 'zigzag') {
    const period = Math.max(8, Math.sqrt(p.count) * (p.layout === 'wave' ? 5 : 3));
    let parent = add(0, 0);
    for (let i = 1; i < p.count; i++) {
      const phase = i * TAU / period;
      const wave = p.layout === 'wave' ? Math.sin(phase) : 2 / Math.PI * Math.asin(Math.sin(phase));
      parent = advance(parent, .75 * p.curvature * wave, i);
    }
  } else {
    const stairs = p.layout.startsWith('stairs');
    const perTerrace = Math.ceil(p.count / 12), terraceCount = Math.floor((p.count - 1) / perTerrace);
    const columns = Math.max(5, Math.round(Math.sqrt(p.count) * 1.15));
    let parent = null, heading = 0, straight = 0, turn = 0, turnSign = 1;
    for (let i = 0; i < p.count; i++) {
      const level = Math.floor(i / perTerrace);
      const elevation = stairs ? (p.layout === 'stairs-up' ? level : terraceCount - level) * p.stairRise : 0;
      if (stairs) heading = .15 * (p.curvature - 1) * Math.sin(i * .15);
      const d = parent ? advance(parent, heading, i, 0, elevation) : add(0, 0, elevation, heading);
      if (!stairs) {
        if (turn > 0) { heading += turnSign * Math.PI / 6 * p.curvature; turn--; if (!turn) { straight = 0; turnSign *= -1; } }
        else if (++straight >= columns) { turn = 6; heading += turnSign * Math.PI / 6 * p.curvature; turn--; }
        d.angle = heading;
      }
      parent = d;
    }
  }
  return applyRunTransform({ params, dominoes, links, roots: [0] });

  function buildCurve() {
    const closed = p.layout !== 'helix', turns = 1 + p.curvature * 1.5;
    const sides = Math.round(clamp(5 + (p.curvature - 1) * 2, 3, 9));
    const vertex = index => [Math.cos(index * TAU / sides), Math.sin(index * TAU / sides)];
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const point = t => {
      const a = t * TAU;
      if (p.layout === 'figure-eight') return [Math.sin(a), .5 * p.curvature * Math.sin(a * 2)];
      if (p.layout === 'flower') { const r = 1 + .14 * p.curvature * Math.cos(5 * a); return [r * Math.cos(a), r * Math.sin(a)]; }
      if (p.layout === 'helix') return [Math.cos(a * turns), Math.sin(a * turns)];
      const position = t * sides * 2, segment = Math.floor(position), fraction = position - segment;
      const i = Math.floor(segment / 2), before = vertex(i), corner = vertex(i + 1), after = vertex(i + 2);
      const incoming = mix(corner, before, .32), outgoing = mix(corner, after, .32);
      if (segment % 2 === 0) return mix(mix(before, corner, .32), incoming, fraction);
      return mix(mix(incoming, corner, fraction), mix(corner, outgoing, fraction), fraction);
    };
    // Bounded arc-length sampling prevents corners from accumulating pieces.
    const resolution = Math.max(256, p.count * 12), samples = [{ point: point(0), length: 0 }];
    let total = 0;
    for (let i = 1; i <= resolution; i++) {
      const next = point(i / resolution), previous = samples.at(-1).point;
      total += Math.hypot(next[0] - previous[0], next[1] - previous[1]);
      samples.push({ point: next, length: total });
    }
    const intervals = closed ? p.count : p.count - 1, scale = base * p.spacing * intervals / total;
    const positions = []; let cursor = 1;
    for (let i = 0; i < p.count; i++) {
      const length = total * i / intervals;
      while (cursor < samples.length - 1 && samples[cursor].length < length) cursor++;
      const a = samples[cursor - 1], b = samples[cursor], t = (length - a.length) / Math.max(1e-12, b.length - a.length);
      const xy = mix(a.point, b.point, t); positions.push([xy[0] * scale, xy[1] * scale]);
    }
    let parent = null;
    for (let i = 0; i < positions.length; i++) {
      const current = positions[i], next = positions[(i + 1) % positions.length], previous = positions[Math.max(0, i - 1)];
      const heading = !closed && i === positions.length - 1
        ? Math.atan2(current[1] - previous[1], current[0] - previous[0])
        : Math.atan2(next[1] - current[1], next[0] - current[0]);
      const elevation = p.layout === 'helix' ? i * p.stairRise : 0;
      parent = add(current[0], current[1], elevation, heading, parent, i);
    }
    if (closed) links.push({ from: parent.id, to: dominoes[0].id });
  }
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
export const MAX_COMPILED_PUSHES = MAX_DOMINOES;

/** Additional pushes use finite model-time offsets; Run speed is applied by the player. */
export function compileRun(run, { startIds = run.roots, force = 1, pushes = [] } = {}) {
  const gestures = Array.isArray(pushes) ? pushes.slice(0, MAX_COMPILED_PUSHES)
    .filter(push => push && Number.isFinite(push.time) && push.time >= 0)
    .map(push => ({ id: push.id, time: push.time, force: push.force ?? 1 }))
    .sort((a, b) => a.time - b.time) : [];
  if (gestures.length) return compilePushedRun(run, { startIds, force, pushes: gestures });
  const dominoes = run.dominoes.slice(0, MAX_DOMINOES), byId = new Map(dominoes.map(d => [d.id, d]));
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

function compilePushedRun(run, { startIds, force, pushes }) {
  const simulation = createRunSimulation(run, { startIds, force, autoStand: false, speed: 1 });
  const advanceTo = time => {
    while (!simulation.advance(time).complete) { /* Resume a bounded transition batch. */ }
  };
  for (const push of pushes) {
    // Materialize standing/fallen state before deciding whether this push can
    // act. Pre-queuing a later gesture would consult the wrong historical pose.
    advanceTo(push.time);
    simulation.trigger([push.id], push.time, push.force);
  }
  while (simulation.hasPending) advanceTo(simulation.nextTime);
  const events = simulation.events.map(({ eventId, occurrenceId, ...event }) => event);
  events.sort((a, b) => a.time - b.time || a.id - b.id || (a.type === 'contact' ? -1 : 1));
  const falls = simulation.falls.map(({ occurrenceId, standStart, standEnd, ...fall }) => fall);
  const fallen = new Set(falls.map(fall => fall.id));
  return { events, falls, duration: simulation.duration,
    stalledIds: run.dominoes.slice(0, MAX_DOMINOES).filter(domino => !fallen.has(domino.id)).map(domino => domino.id),
    reachableCount: fallen.size, blockedLinks: simulation.blockedLinks };
}

export const STAND_RISE_SECONDS = .4;
// A four-second forecast plus one recent second must fit even at 1024 tiles,
// minimum recovery (.05 + .4 s) and maximum speed. Keep both pose and event
// histories until the app has consumed the earliest predicted impacts.
export const RUN_HISTORY_LIMITS = Object.freeze({ events: 32768, falls: 16384, transitionsPerAdvance: 32768 });

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
 * fork() makes an independent exact continuation, including pending impacts,
 * recovery and manual triggers; IDs already assigned keep their values.
 */
export function createRunSimulation(run, options = {}) {
  return makeRunSimulation(run, options);
}

// Checkpoints remain private: fork is the only way to construct a continuation.
function makeRunSimulation(run, options, checkpoint = null) {
  const params = sanitizeParams(run.params || {});
  const speed = bounded(options.speed, .05, 12, params.speed);
  const autoStand = typeof options.autoStand === 'boolean' ? options.autoStand : params.autoStand;
  const standDelay = bounded(options.standDelay, .05, 60, params.standDelay);
  const dominoes = run.dominoes.slice(0, MAX_DOMINOES).map(d => ({ ...d }));
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
  const { heap, events, falls, lastFalls, seen, blocked, manualQueued } = checkpoint ?? {
    heap: [], events: [], falls: [], lastFalls: new Map(), seen: new Set(), blocked: new Map(), manualQueued: new Map(),
  };
  let { time = 0, endTime = 0, serial = 0, occurrenceId = 0, eventId = 0 } = checkpoint ?? {};
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
  const fork = () => {
    // One graph clone preserves aliases such as manualQueued -> heap entry and
    // lastFalls -> retained fall, while sharing no mutable history with a branch.
    const state = structuredClone({ heap, events, falls, lastFalls, seen, blocked, manualQueued,
      time, endTime, serial, occurrenceId, eventId });
    const snapshot = { params, dominoes: dominoes.map(domino => ({ ...domino })),
      links: [...routes.values()].flatMap(outgoing => outgoing.map(route => ({ ...route.link }))), roots: [] };
    return makeRunSimulation(snapshot, { speed, autoStand, standDelay }, state);
  };
  if (!checkpoint) trigger(options.startIds ?? run.roots, 0, options.force ?? 1);
  return {
    advance, prune, trigger, fork,
    get events() { return events; }, get falls() { return falls; },
    get time() { return time; }, get endTime() { return endTime; }, get duration() { return endTime; },
    get hasPending() { return heap.length > 0; }, get nextTime() { return heap[0]?.time ?? Infinity; },
    get pendingCount() { return heap.length; }, get reachableCount() { return seen.size; },
    get blockedLinks() { return [...blocked.values()]; }, get lastFalls() { return lastFalls; },
  };
}
