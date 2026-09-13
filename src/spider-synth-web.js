/** Rule-built, bounded silk graphs. Natural presets are biological approximations;
 * artistic presets deliberately depart from animal construction. See
 * SPIDER_WEB_CONSTRUCTION_RULES for the construction sequence and evidence IDs.
 * Crossings are not junctions unless the segments share the same node ID. */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const isWalkingStage = stage => stage !== 'interception' && stage !== 'suspension' && stage !== 'retreat';
function freeze(value) { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); }
function rng(seed) { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) | 0; let v = Math.imul(state ^ state >>> 15, state | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61); return ((v ^ v >>> 14) >>> 0) / 4294967296; }; }
const family = (id, label, settings, basis) => ({ id, label, settings: { preset: id, ...settings }, basis });
export const SPIDER_WEB_PRESETS = freeze([
  family('argiope', 'Argiope · writing spider', { anchors: 7, asymmetry: .3, irregularity: .24, spacing: .58, stabilimentum: .65 }, 'natural · Argiope aurantia inspired'),
  family('orb', 'Orb · irregular frame', { anchors: 6, asymmetry: .12, irregularity: .2 }, 'natural · orb approximation'),
  family('spiral', 'Open capture spiral', { anchors: 5, rings: 7, irregularity: .12, spacing: .2 }, 'natural · open orb approximation'),
  family('eccentric', 'Eccentric orb', { anchors: 8, asymmetry: .95, irregularity: .32, spacing: .8 }, 'natural · asymmetric orb inspired'),
  family('missing-sector', 'Signal-thread retreat', { anchors: 6, asymmetry: .32, irregularity: .18 }, 'natural · Zygiella inspired'),
  family('ladder', 'Ladder · elongated trap', { anchors: 5, rings: 16, spokes: 12, spacing: .7, irregularity: .2 }, 'natural · ladder-orb inspired'),
  family('sheet', 'Sheet · interception mesh', { anchors: 9, spokes: 18, rings: 12, irregularity: .65, depth: .08 }, 'natural · sheet approximation'),
  family('funnel', 'Sheet into funnel retreat', { anchors: 8, depth: .3, rings: 13, irregularity: .4 }, 'natural · funnel approximation'),
  family('bowl', 'Bowl and upper snare', { anchors: 7, depth: .3, irregularity: .35, spacing: .65 }, 'natural · bowl-sheet inspired'),
  family('dome', 'Dome and support lines', { anchors: 10, depth: .25, irregularity: .3 }, 'natural · dome-sheet inspired'),
  family('tangle', 'Tangle · gumfoot scaffold', { anchors: 10, irregularity: .85, depth: .35, spokes: 14, rings: 8 }, 'natural · theridiid inspired'),
  family('triangle', 'Triangle · tension fan', { anchors: 3, spokes: 8, rings: 12, irregularity: .15 }, 'natural · Hyptiotes inspired'),
  family('lace', 'Artistic · diagonal lace', { anchors: 6, irregularity: .22, twist: .12 }, 'artistic'),
  family('wheel', 'Artistic · double wheel', { anchors: 8, spokes: 12, rings: 7 }, 'artistic'),
  family('star', 'Artistic · scalloped star', { anchors: 10, twist: .3, irregularity: .15 }, 'artistic'),
  family('honeycomb', 'Artistic · hexagonal cells', { anchors: 6, rings: 10, spokes: 14 }, 'artistic'),
  family('constellation', 'Artistic · linked clusters', { anchors: 9, irregularity: .85, depth: .16, twist: -.3 }, 'artistic'),
]);
export const SPIDER_WEB_PARAMETERS = freeze([
  { key: 'spokes', label: 'Radii / branches', min: 8, max: 24, step: 1, default: 16 },
  { key: 'rings', label: 'Capture density', min: 3, max: 16, step: 1, default: 10 },
  { key: 'anchors', label: 'Frame anchors', min: 3, max: 12, step: 1, default: 7 },
  { key: 'spacing', label: 'Mesh spacing', min: 0, max: 1, step: .01, default: .45 },
  { key: 'asymmetry', label: 'Hub / shape offset', min: 0, max: 1, step: .01, default: 0 },
  { key: 'twist', label: 'Twist', min: -1, max: 1, step: .01, default: 0 },
  { key: 'irregularity', label: 'Construction variation', min: 0, max: 1, step: .01, default: .2 },
  { key: 'depth', label: 'Depth', min: 0, max: .45, step: .01, default: 0 },
  { key: 'stabilimentum', label: 'Writing zigzag', min: 0, max: 1, step: .01, default: 0 },
]);
const rule = (basis, stages, sources, limit) => ({ basis, stages, sources, limit });
export const SPIDER_WEB_CONSTRUCTION_RULES = freeze({
  argiope: rule('natural approximation', ['unequal external anchors', 'polygonal frame', 'eccentric hub and unequal radii', 'dry hub/free zone', 'inward capture spiral', 'vertical stabilimentum'], ['reed-witt-1969', 'eberhard-2014'], 'Normalized geometry; the scanned specimen remains A. bruennichi. Decoration function is not asserted.'),
  orb: rule('natural approximation', ['external scaffold', 'subdivided polygonal frame', 'unequal radial angles', 'dry hub/free zone', 'continuous inward capture spiral'], ['eberhard-2014', 'corver-2021'], 'Local spacing rules are bounded approximations, not a recovered individual web.'),
  spiral: rule('natural approximation', ['sparse anchor scaffold', 'dry radial support', 'free zone', 'open continuous capture spiral'], ['eberhard-2014'], 'An open orb variation, not a distinct species.'),
  eccentric: rule('natural approximation', ['unequal anchors', 'offset hub', 'unequal radial lengths', 'eccentric capture spiral with graded spacing'], ['zschokke-2011', 'eberhard-2014'], 'Hub offset is exaggerated for playability.'),
  'missing-sector': rule('natural approximation', ['anchored orb', 'capture-free sector', 'signal thread', 'peripheral retreat'], ['mortimer-2015'], 'The free sector contains a signal thread, not capture mesh.'),
  ladder: rule('natural approximation', ['elongated scaffold', 'lower hub', 'long diverging radii', 'successive bowed capture traverses'], ['harmer-herberstein-2010'], 'Elongated orb-inspired fan; not a rectangular woven ladder.'),
  sheet: rule('natural approximation', ['irregular perimeter anchors', 'connected local sheet mesh', 'upper interception lines'], ['eberhard-hazzi-2017'], 'Triangulation approximates a connected dense non-adhesive sheet.'),
  funnel: rule('natural approximation', ['irregular sheet', 'off-center depressed mouth', 'retreat tube', 'upper interception lines'], ['eberhard-hazzi-2017'], 'The tubular retreat is connected to the sheet; it is not a conical orb.'),
  bowl: rule('natural approximation', ['anchored concave sheet', 'upper snare', 'suspension lines'], ['linyphiid-architecture-2006'], 'A bowl-sheet family approximation.'),
  dome: rule('natural approximation', ['convex sheet mesh', 'unequal perimeter supports', 'overhead interception scaffold'], ['linyphiid-architecture-2006'], 'A dome-sheet family approximation.'),
  tangle: rule('natural approximation', ['external scaffold', 'spatial supporting branches', 'cross-braces', 'descending gumfoot lines'], ['eberhard-2008'], 'Representative structural motifs; theridiid web architectures vary widely.'),
  triangle: rule('natural approximation', ['rear tension line', 'fan radii', 'cribellate capture traverses', 'outer anchors'], ['han-2019'], 'Four primary rays at the default; more rays are an artistic extension.'),
  lace: rule('artistic', ['two oblique families', 'shared crossing junctions', 'irregular perimeter attachments'], [], 'Authored diagonal lace, not a species claim.'),
  wheel: rule('artistic', ['irregular frame', 'two interleaved radial fans', 'closed capture bands'], [], 'Authored wheel, not animal construction.'),
  star: rule('artistic', ['scalloped frame', 'twisting rays', 'alternating capture cells'], [], 'Authored star, not animal construction.'),
  honeycomb: rule('artistic', ['joined hexagonal cells', 'merged shared vertices', 'unequal external attachments'], [], 'Hexagonal graph, not an orb-web claim.'),
  constellation: rule('artistic', ['spatial clusters', 'local strand fans', 'long bridge threads'], [], 'Authored cluster network, not an animal web.'),
});
export function normalizeSpiderWeb(input = {}) {
  const preset = SPIDER_WEB_PRESETS.find(item => item.id === input.preset) || SPIDER_WEB_PRESETS[1];
  const settings = { ...preset.settings, ...input };
  const out = { preset: preset.id, tension: clamp(finite(settings.tension, 1), .2, 4), seed: finite(settings.seed, 1) >>> 0 };
  for (const p of SPIDER_WEB_PARAMETERS) out[p.key] = clamp(finite(settings[p.key], p.default), p.min, p.max);
  out.spokes = Math.round(out.spokes); out.rings = Math.round(out.rings); out.anchors = Math.round(out.anchors);
  return out;
}

/** Construction surface is a body-height guide only. Feet always use exact
 * segment projection. Upper interception threads are not a walking surface. */
export function spiderWebHeight(web, x, z) {
  const d = web.depth || 0; if (!d) return 0;
  const r2 = Math.min(1.8, x * x + z * z);
  if (web.preset === 'funnel') return -d * Math.exp(-((x - .48) ** 2 + (z + .38) ** 2) * 10);
  if (web.preset === 'dome') return d * (.8 - r2 * .75);
  if (web.preset === 'bowl') return d * (r2 * .8 - .42);
  if (web.preset === 'tangle' || web.preset === 'constellation') return d * .15 * Math.sin(x * 3.5) * Math.cos(z * 2.7);
  if (web.preset === 'sheet') return d * (.15 * Math.sin(x * 4 + z) - .22 * (1 - Math.min(1, r2)));
  return d * .2 * Math.sin(x * 3 + z * 2);
}

function builder(settings) {
  const random = rng(settings.seed), nodes = [], segments = [], pairs = new Set();
  const node = (x, z, y, role = 'junction') => {
    if (nodes.length >= 1200) throw new RangeError('Spider web node budget exceeded');
    const r = Math.hypot(x, z), a = settings.twist * r * .5, c = Math.cos(a), s = Math.sin(a);
    const px = x * c - z * s, pz = x * s + z * c;
    const id = nodes.length; nodes.push({ id, x: px, y: y == null ? spiderWebHeight(settings, px, pz) : clamp(y, -.65, .65), z: pz, role }); return id;
  };
  const edge = (a, b, kind = 'radial', threadType = 'dry', stage = 'support') => {
    if (a === b || a < 0 || b < 0) return;
    const key = Math.min(a, b) * 1200 + Math.max(a, b); if (pairs.has(key)) return;
    const p = nodes[a], q = nodes[b], dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, length = Math.hypot(dx, dy, dz);
    if (length < 1e-7) return;
    if (segments.length >= 2400) throw new RangeError('Spider web segment budget exceeded');
    pairs.add(key); segments.push({ id: segments.length, a, b, length, angle: Math.atan2(dz, dx), kind, threadType, stage, walkable: isWalkingStage(stage) });
  };
  return { settings, random, nodes, segments, node, edge };
}
function anchors(b, sx = 1, sz = 1) {
  const { settings: w, random, node } = b, points = [];
  const phase = -.25 + (random() - .5) * .25;
  // Bounded jitter preserves an enclosing scaffold, even at three anchors.
  // Unconstrained normalized weights can create a >180-degree gap and place
  // the hub outside the polygon, leaving some construction rays unbounded.
  const jitter = (w.anchors === 3 ? .04 : Math.min(.18, TAU / w.anchors * .24)) * (.35 + w.irregularity * .65);
  for (let i = 0; i < w.anchors; i += 1) {
    const angle = phase + i * TAU / w.anchors + (random() - .5) * jitter * 2;
    const r = .98 + (random() - .5) * (.12 + w.irregularity * .3);
    const x = Math.cos(angle) * r * sx, z = Math.sin(angle) * r * sz;
    points.push({ x, z, id: node(x, z, undefined, 'anchor') });
  }
  return points;
}
function linkFrame(b, points) { for (let i = 0; i < points.length; i += 1) b.edge(points[i].id, points[(i + 1) % points.length].id, 'frame', 'dry', 'frame'); }
function rayBoundary(points, hx, hz, dx, dz) {
  let best = Infinity, edge = 0, u = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], q = points[(i + 1) % points.length], ex = q.x - a.x, ez = q.z - a.z, det = dx * ez - dz * ex;
    if (Math.abs(det) < 1e-10) continue;
    const ax = a.x - hx, az = a.z - hz, t = (ax * ez - az * ex) / det, v = (ax * dz - az * dx) / det;
    if (t > 0 && v >= -1e-8 && v <= 1 + 1e-8 && t < best) { best = t; edge = i; u = clamp(v, 0, 1); }
  }
  if (!Number.isFinite(best)) throw new RangeError('Spider web ray outside its frame');
  return { x: hx + dx * best, z: hz + dz * best, edge, u, distance: best };
}
function orb(b) {
  const { settings: w, random, node, edge } = b;
  const star = w.preset === 'star', wheel = w.preset === 'wheel', gap = w.preset === 'missing-sector';
  const frame = anchors(b, 1 - w.asymmetry * .1, 1);
  if (star) for (let i = 0; i < frame.length; i += 1) {
    if (i % 2) { frame[i].x *= .7; frame[i].z *= .7; const p = b.nodes[frame[i].id]; p.x *= .7; p.z *= .7; }
  }
  let clearance = Infinity;
  for (let i = 0; i < frame.length; i += 1) {
    const a = frame[i], c = frame[(i + 1) % frame.length];
    clearance = Math.min(clearance, Math.abs(a.x * c.z - a.z * c.x) / Math.hypot(c.x - a.x, c.z - a.z));
  }
  const hubScale = Math.min(1, clearance * .72 / Math.max(1e-9, w.asymmetry * Math.hypot(.16, .23)));
  const hx = w.asymmetry * .16 * hubScale, hz = w.asymmetry * .23 * hubScale, hub = node(hx, hz, undefined, 'hub');
  const count = w.spokes, gapWidth = gap ? .8 : 0, offset = .45 + gapWidth / 2;
  const weights = Array.from({ length: count }, () => 1 + (random() - .5) * (.5 + w.irregularity * 1.05));
  const sum = weights.reduce((a, v) => a + v, 0); const rays = []; let angle = offset;
  const frameSplits = frame.map((p, i) => [{ id: p.id, u: 0 }, { id: frame[(i + 1) % frame.length].id, u: 1 }]);
  for (let i = 0; i < count; i += 1) {
    const hit = rayBoundary(frame, hx, hz, Math.cos(angle), Math.sin(angle));
    const tip = node(hit.x, hit.z, undefined, 'frame-junction'); frameSplits[hit.edge].push({ id: tip, u: hit.u });
    const skew = (random() - .5) * w.irregularity * .5;
    const inner = .105 + random() * .018;
    const dry = node(hx + (hit.x - hx) * inner * .55, hz + (hit.z - hz) * inner * .55, undefined, 'hub');
    // The capture area is roughly oval inside the frame, rather than a scaled
    // copy of every polygon edge. Short radii adapt to nearby attachments.
    const dx = Math.cos(angle), dz = Math.sin(angle), aa = dx * dx / .78 ** 2 + dz * dz / .84 ** 2;
    const bb = 2 * (hx * dx / .78 ** 2 + (hz + .04) * dz / .84 ** 2), cc = hx * hx / .78 ** 2 + (hz + .04) ** 2 / .84 ** 2 - 1;
    const captureBoundary = (-bb + Math.sqrt(Math.max(0, bb * bb - 4 * aa * cc))) / (2 * aa);
    const outer = Math.min(.84, captureBoundary / hit.distance);
    const ray = { x: hit.x, z: hit.z, skew, inner, outer, tip, dry, previous: 1, levels: [{ id: hub, r: 0 }, { id: dry, r: inner * .55 }, { id: tip, r: 1 }] };
    rays.push(ray); angle += (TAU - gapWidth) * weights[i] / sum;
  }
  for (const splits of frameSplits) { splits.sort((a, c) => a.u - c.u); for (let i = 1; i < splits.length; i += 1) edge(splits[i - 1].id, splits[i].id, 'frame', 'dry', 'frame'); }
  for (let i = 0; i < count; i += 1) if (!gap || i < count - 1) edge(rays[i].dry, rays[(i + 1) % count].dry, 'radial', 'dry', 'hub');
  const path = []; const exponent = .8 + w.spacing * 1.4;
  // An inward continuous capture thread crosses each radial once per turn.
  // It never closes a concentric loop; radial chains share the exact junctions.
  for (let turn = 0; turn < w.rings; turn += 1) for (let i = 0; i < count; i += 1) {
    const ray = rays[i], t = 1 - (turn + i / count) / w.rings;
    const local = Math.pow(t, exponent + ray.skew);
    const step = Math.max(.002, (ray.outer - ray.inner) * (exponent + ray.skew) * Math.pow(Math.max(t, .001), exponent + ray.skew - 1) / w.rings);
    const variation = (random() - .5) * (.12 + w.irregularity * .7) * step;
    const r = Math.min(ray.previous - .0001, clamp(ray.inner + (ray.outer - ray.inner) * local + variation, ray.inner, ray.outer));
    ray.previous = r;
    const id = node(hx + (ray.x - hx) * r, hz + (ray.z - hz) * r, undefined, 'capture-junction');
    ray.levels.push({ id, r });
    if (path.length && (!gap || i !== 0)) edge(path[path.length - 1], id, 'spiral', 'capture', 'capture');
    if (wheel && i === count - 1) edge(id, path[path.length - count + 1], 'spiral', 'capture', 'capture');
    if (star && turn > 0 && i % 2 === 0) edge(ray.levels[ray.levels.length - 2].id, id, 'spiral', 'capture', 'capture');
    path.push(id);
  }
  // Additional partial traverses below an eccentric hub increase lower mesh
  // area without forcing an equal number of circular loops in every sector.
  if (w.asymmetry > .25 && ['argiope', 'eccentric'].includes(w.preset)) {
    for (let turn = 1; turn < w.rings - 1; turn += 3) {
      let previous = -1;
      for (const ray of rays) {
        if (ray.z >= hz - .03) { previous = -1; continue; }
        const r = (ray.levels[3 + turn].r + ray.levels[4 + turn].r) * .5;
        const id = node(hx + (ray.x - hx) * r, hz + (ray.z - hz) * r, undefined, 'capture-return');
        if (previous >= 0) edge(previous, id, 'spiral', 'capture', 'capture-return'); previous = id; ray.levels.push({ id, r });
      }
    }
  }
  for (const ray of rays) { ray.levels.sort((a, c) => a.r - c.r); for (let i = 1; i < ray.levels.length; i += 1) edge(ray.levels[i - 1].id, ray.levels[i].id, 'radial', 'dry', 'radii'); }
  if (wheel) for (let i = 0; i < count; i += 2) edge(rays[i].dry, rays[(i + 1) % count].levels[Math.floor(w.rings / 2)].id, 'radial', 'dry', 'radii');
  if (gap) {
    const hit = rayBoundary(frame, hx, hz, Math.cos(.45), Math.sin(.45));
    const retreat = node(hit.x * 1.03, hit.z * 1.03, undefined, 'retreat'); edge(hub, retreat, 'radial', 'signal', 'retreat');
    edge(retreat, frame[hit.edge].id, 'frame', 'dry', 'retreat'); edge(retreat, frame[(hit.edge + 1) % frame.length].id, 'frame', 'dry', 'retreat');
  }
  return { hub, hx, hz };
}
function fan(b, ladder) {
  const { settings: w, random, node, edge } = b;
  const hx = ladder ? -.05 + w.asymmetry * .15 : -.68, hz = ladder ? -.68 : -.06;
  const hub = node(hx, hz, undefined, 'hub');
  const rayCount = ladder ? Math.max(5, Math.round(w.spokes * .6)) : Math.max(4, Math.round(w.spokes / 2));
  const rows = ladder ? w.rings * 2 : w.rings; const rays = [];
  for (let i = 0; i < rayCount; i += 1) {
    const u = i / (rayCount - 1), jitter = (random() - .5) * w.irregularity * .045;
    const x = ladder ? (u - .5) * (.72 + w.asymmetry * .15) + jitter : .92 + jitter;
    const z = ladder ? 1.02 - Math.abs(u - .5) * .12 + jitter : (u - .5) * 1.65 + jitter;
    const ids = [hub];
    for (let row = 1; row <= rows + 1; row += 1) {
      const t = Math.pow(row / (rows + 1), .8 + w.spacing * .55);
      const p = node(hx + (x - hx) * t, hz + (z - hz) * t, undefined, row === rows + 1 ? 'anchor' : 'capture-junction');
      edge(ids[ids.length - 1], p, 'radial', 'dry', 'radii'); ids.push(p);
      if (i > 0) edge(rays[i - 1][row], p, row === rows + 1 ? 'frame' : 'spiral', row === rows + 1 ? 'dry' : 'capture', row === rows + 1 ? 'frame' : 'capture');
    }
    rays.push(ids);
  }
  const rear = node(ladder ? hx : -1.08, ladder ? -1.03 : hz, undefined, 'anchor'); edge(rear, hub, 'frame', 'signal', 'tension');
  for (let i = 0; i < w.anchors - 2; i += 1) {
    const u = (i + 1) / Math.max(1, w.anchors - 1), target = rays[Math.round(u * (rayCount - 1))][rows + 1];
    const p = b.nodes[target]; const id = node(ladder ? p.x * 1.18 : p.x + .11, ladder ? p.z + .1 : p.z * 1.08, undefined, 'anchor'); edge(target, id, 'frame', 'dry', 'anchor');
  }
  // Small dry hub fan gives the lower hub a connected support platform.
  if (ladder) for (const sign of [-1, 1]) { const id = node(hx + sign * .23, -.91, undefined, 'anchor'); edge(hub, id, 'radial', 'dry', 'hub'); edge(rear, id, 'frame', 'dry', 'frame'); edge(id, rays[sign < 0 ? 0 : rayCount - 1][Math.min(4, rows)], 'radial', 'dry', 'hub'); }
  return { hub, hx, hz };
}
// Incremental Delaunay construction makes every local sheet intersection a
// shared junction. No unconnected crossing grid is used as a walking surface.
function triangulate(points) {
  const n = points.length, p = [...points, { x: -8, z: -6 }, { x: 0, z: 9 }, { x: 8, z: -6 }];
  const triangle = (a, b, c) => {
    const A = p[a], B = p[b], C = p[c], d = 2 * (A.x * (B.z - C.z) + B.x * (C.z - A.z) + C.x * (A.z - B.z));
    if (Math.abs(d) < 1e-12) return null;
    const aa = A.x * A.x + A.z * A.z, bb = B.x * B.x + B.z * B.z, cc = C.x * C.x + C.z * C.z;
    const x = (aa * (B.z - C.z) + bb * (C.z - A.z) + cc * (A.z - B.z)) / d;
    const z = (aa * (C.x - B.x) + bb * (A.x - C.x) + cc * (B.x - A.x)) / d;
    return { a, b, c, x, z, r2: (x - A.x) ** 2 + (z - A.z) ** 2 };
  };
  let triangles = [triangle(n, n + 1, n + 2)];
  for (let i = 0; i < n; i += 1) {
    const boundary = new Map(), keep = [];
    for (const t of triangles) {
      if ((p[i].x - t.x) ** 2 + (p[i].z - t.z) ** 2 > t.r2 + 1e-10) { keep.push(t); continue; }
      for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const key = Math.min(a, b) * (n + 3) + Math.max(a, b); if (boundary.has(key)) boundary.delete(key); else boundary.set(key, [a, b]); }
    }
    for (const [a, b] of boundary.values()) { const t = triangle(a, b, i); if (t) keep.push(t); }
    triangles = keep;
  }
  return triangles.filter(t => t.a < n && t.b < n && t.c < n);
}
function sheet(b) {
  const { settings: w, random, node, edge } = b, frame = anchors(b, 1.02, .9);
  const points = frame.map(p => ({ ...p }));
  const count = Math.max(55, Math.round(w.spokes * w.rings * .85));
  // A bounded best-of-five dart sampler avoids both rectilinear lattices and
  // large unsupported holes. Spacing biases density toward the central sheet.
  for (let i = 0; i < count; i += 1) {
    let best = null, bestDistance = -1;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const angle = random() * TAU, boundary = rayBoundary(frame, 0, 0, Math.cos(angle), Math.sin(angle));
      const r = Math.pow(random(), .5 + w.spacing * .4) * .96;
      const candidate = { x: boundary.x * r, z: boundary.z * r }; let d = Infinity;
      for (const p of points) d = Math.min(d, (p.x - candidate.x) ** 2 + (p.z - candidate.z) ** 2);
      if (d > bestDistance) { bestDistance = d; best = candidate; }
    }
    best.x += w.asymmetry * .07 * (1 - Math.min(1, Math.hypot(best.x, best.z)));
    best.id = node(best.x, best.z, undefined, 'sheet-junction'); points.push(best);
  }
  for (const t of triangulate(points)) for (const [a, c] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) edge(points[a].id, points[c].id, 'spiral', 'dry', 'sheet');
  linkFrame(b, frame);
  // Separate upper supports/interception threads are connected to the sheet.
  // They do not turn into an extra hidden support plane for the foot planner.
  const upper = [];
  for (let i = 0; i < w.anchors; i += 1) {
    const p = frame[i], q = points[w.anchors + Math.floor(random() * count)];
    const x = p.x * (.62 + random() * .2), z = p.z * (.62 + random() * .2);
    const id = node(x, z, spiderWebHeight(w, x, z) + w.depth * (.45 + random() * .35), 'upper-anchor');
    edge(q.id, id, 'radial', 'dry', 'interception'); edge(p.id, id, 'frame', 'dry', 'suspension');
    if (upper.length) edge(upper[upper.length - 1], id, 'radial', 'dry', 'interception'); upper.push(id);
  }
  if (w.preset === 'bowl') {
    for (let i = 0; i < upper.length; i += 1) edge(upper[i], upper[(i + 2) % upper.length], 'radial', 'dry', 'interception');
  }
  if (w.preset === 'funnel') {
    let nearest = points[0]; for (const p of points) if (Math.hypot(p.x - .48, p.z + .38) < Math.hypot(nearest.x - .48, nearest.z + .38)) nearest = p;
    const sides = 7, rows = 5, tube = [];
    for (let r = 0; r <= rows; r += 1) {
      const ring = [], t = r / rows, radius = .105 * (1 - t * .64);
      const x = .48 + t * .46, z = -.38 - t * .13, y = spiderWebHeight(w, .48, -.38) - w.depth * t * .22;
      for (let i = 0; i < sides; i += 1) {
        const a = i * TAU / sides, id = node(x, z + Math.cos(a) * radius, y + Math.sin(a) * radius, 'retreat'); ring.push(id);
        if (r) edge(tube[r - 1][i], id, 'radial', 'dry', 'retreat'); else edge(nearest.id, id, 'spiral', 'dry', 'retreat');
        if (i) edge(ring[i - 1], id, 'spiral', 'dry', 'retreat');
      }
      edge(ring[0], ring[sides - 1], 'spiral', 'dry', 'retreat'); tube.push(ring);
    }
  }
  return {};
}
function nearestNode(b, x, z, limit = b.nodes.length) {
  let best = 0, distance = Infinity;
  for (let i = 0; i < limit; i += 1) { const p = b.nodes[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < distance) { distance = d; best = i; } }
  return best;
}
function tangle(b, clusters = false) {
  const { settings: w, random, node, edge } = b, frame = anchors(b); linkFrame(b, frame);
  const count = Math.max(55, Math.round(w.spokes * w.rings * (clusters ? .48 : .7))), points = [];
  const centers = Array.from({ length: clusters ? 6 : 1 }, (_, i) => ({ x: clusters && i ? Math.cos((i - 1) * TAU / 5) * .53 : 0, z: clusters && i ? Math.sin((i - 1) * TAU / 5) * .53 : 0 }));
  for (let i = 0; i < count; i += 1) {
    const center = centers[i % centers.length], a = random() * TAU, r = Math.sqrt(random()) * (clusters ? .27 : .8);
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    const y = spiderWebHeight(w, x, z) + (i % 4 === 0 ? (random() - .3) * w.depth : (random() - .5) * w.depth * .25);
    const id = node(x, z, y, clusters ? 'cluster' : 'scaffold'); points.push(id);
    const candidates = b.nodes.slice(0, id).map(p => ({ id: p.id, d: (p.x - b.nodes[id].x) ** 2 + (p.y - y) ** 2 + (p.z - b.nodes[id].z) ** 2 })).sort((a, c) => a.d - c.d);
    for (let k = 0; k < Math.min(candidates.length, clusters ? 2 : 3); k += 1) edge(id, candidates[k].id, k ? 'spiral' : 'radial', 'dry', 'scaffold');
  }
  if (!clusters) for (let i = 0; i < points.length; i += Math.max(3, Math.round(10 - w.spacing * 5))) {
    const p = b.nodes[points[i]], id = node(p.x + (random() - .5) * .06, p.z + (random() - .5) * .06, -w.depth * .8, 'gumfoot-anchor');
    edge(points[i], id, 'spiral', 'gumfoot', 'gumfoot');
  }
  return {};
}
function lace(b) {
  const { settings: w, node, edge, random } = b, cols = Math.round(w.spokes * .6), rows = w.rings, ids = [];
  for (let j = 0; j <= rows; j += 1) {
    const row = [];
    for (let i = 0; i <= cols; i += 1) {
      const u = i / cols - .5, v = j / rows - .5, jitter = w.irregularity * .018;
      const id = node((u + v * .42) * 1.3 + (random() - .5) * jitter, (v - u * .3) * 1.35 + (random() - .5) * jitter, undefined, 'lace-junction'); row.push(id);
      if (i) edge(row[i - 1], id, 'spiral', 'dry', 'lace'); if (j) edge(ids[j - 1][i], id, 'radial', 'dry', 'lace');
      if (i && j && (i + j) % 2 === 0) edge(ids[j - 1][i - 1], id, 'spiral', 'dry', 'lace');
    }
    ids.push(row);
  }
  const frame = anchors(b); linkFrame(b, frame); for (const p of frame) edge(p.id, nearestNode(b, b.nodes[p.id].x, b.nodes[p.id].z, (rows + 1) * (cols + 1)), 'frame', 'dry', 'anchor');
  return {};
}
function honeycomb(b) {
  const { settings: w, node, edge } = b, cells = Math.max(3, Math.round((w.spokes + w.rings) / 7)), size = .78 / (cells * 1.5), merged = new Map();
  for (let q = -cells; q <= cells; q += 1) for (let r = -cells; r <= cells; r += 1) {
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) >= cells) continue;
    const x = size * 1.5 * q, z = size * Math.sqrt(3) * (r + q / 2), ring = [];
    for (let i = 0; i < 6; i += 1) {
      const px = x + size * Math.cos(i * TAU / 6), pz = z + size * Math.sin(i * TAU / 6), key = `${Math.round(px * 1e7)}:${Math.round(pz * 1e7)}`;
      if (!merged.has(key)) merged.set(key, node(px, pz, undefined, 'hex-junction')); ring.push(merged.get(key));
    }
    for (let i = 0; i < 6; i += 1) edge(ring[i], ring[(i + 1) % 6], 'spiral', 'dry', 'cells');
  }
  const innerCount = b.nodes.length, frame = anchors(b); linkFrame(b, frame);
  for (const p of frame) edge(p.id, nearestNode(b, b.nodes[p.id].x, b.nodes[p.id].z, innerCount), 'frame', 'dry', 'anchor');
  return {};
}
function writing(b, center) {
  const { settings: w, node, edge } = b; if (!w.stabilimentum) return;
  const baseCount = b.nodes.length, count = 12 + Math.round(w.stabilimentum * 24), span = .15 + w.stabilimentum * .55, hx = center.hx || 0, hz = center.hz || 0; let previous = -1;
  for (let i = 0; i <= count; i += 1) {
    const z = hz + (i / count - .5) * span, x = hx + (i % 2 ? 1 : -1) * (.012 + Math.abs(z - hz) * .06) * w.stabilimentum;
    const id = node(x, z, undefined, 'decoration'); if (previous >= 0) edge(previous, id, 'stabilimentum', 'dry', 'decoration');
    if (i === 0 || i === count || i === Math.floor(count / 2)) { const p = b.nodes[id]; edge(nearestNode(b, p.x, p.z, baseCount), id, 'stabilimentum', 'dry', 'decoration'); }
    previous = id;
  }
}
export function createSpiderWeb(input = {}) {
  const settings = normalizeSpiderWeb(input), b = builder(settings); let center;
  if (['sheet', 'funnel', 'bowl', 'dome'].includes(settings.preset)) center = sheet(b);
  else if (settings.preset === 'ladder' || settings.preset === 'triangle') center = fan(b, settings.preset === 'ladder');
  else if (settings.preset === 'tangle' || settings.preset === 'constellation') center = tangle(b, settings.preset === 'constellation');
  else if (settings.preset === 'lace') center = lace(b);
  else if (settings.preset === 'honeycomb') center = honeycomb(b);
  else center = orb(b);
  writing(b, center);
  const web = { ...settings, nodes: b.nodes, segments: b.segments, radius: 1, constructionVersion: 3 };
  buildSpatialIndex(web); return web;
}

/** Geometry identity excludes tension: retuning silk must not rebuild its graph. */
export function spiderWebGeometryKey(input = {}) {
  const w = normalizeSpiderWeb(input);
  return `3:${w.preset}:${w.seed}:${SPIDER_WEB_PARAMETERS.map(p => w[p.key]).join(':')}`;
}

/** Prepare on the main thread. The non-enumerable lookup and scratch buffers
 * never cross the worklet boundary; source graph arrays remain independently owned. */
export function serializeSpiderWeb(web) {
  return { ...normalizeSpiderWeb(web), constructionVersion: 3, radius: 1,
    nodes: web.nodes.map(({ id, x, y, z, role }) => ({ id, x, y, z, role })),
    segments: web.segments.map(({ id, a, b, kind, threadType, stage, walkable }) => ({ id, a, b, kind, threadType, stage, walkable })) };
}

/** Linear bounded validation/hydration for a prepared graph. No construction
 * algorithm, triangulation, sorting, or source-buffer mutation occurs here. */
export function hydrateSpiderWeb(data) {
  if (!data || data.constructionVersion !== 3 || !Array.isArray(data.nodes) || !Array.isArray(data.segments)
    || !data.nodes.length || data.nodes.length > 1200 || !data.segments.length || data.segments.length > 2400) throw new TypeError('Invalid prepared spider web');
  const label = value => typeof value === 'string' && value.length <= 32 ? value : '';
  const nodes = data.nodes.map((p, id) => {
    if (p.id !== id || !['x', 'y', 'z'].every(axis => Number.isFinite(p[axis]) && Math.abs(p[axis]) < 1.5)) throw new TypeError('Invalid prepared spider node');
    return { id, x: p.x, y: p.y, z: p.z, role: label(p.role) };
  });
  const pairs = new Set(), adjacency = Array.from({ length: nodes.length }, () => []);
  const segments = data.segments.map((s, id) => {
    if (s.id !== id || !Number.isInteger(s.a) || !Number.isInteger(s.b) || s.a < 0 || s.b < 0 || s.a >= nodes.length || s.b >= nodes.length || s.a === s.b) throw new TypeError('Invalid prepared spider strand');
    const pair = Math.min(s.a, s.b) * 1200 + Math.max(s.a, s.b); if (pairs.has(pair)) throw new TypeError('Duplicate prepared spider strand'); pairs.add(pair);
    const a = nodes[s.a], b = nodes[s.b], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length = Math.hypot(dx, dy, dz);
    if (length < 1e-7) throw new TypeError('Degenerate prepared spider strand');
    adjacency[s.a].push(s.b); adjacency[s.b].push(s.a);
    const stage = label(s.stage);
    return { id, a: s.a, b: s.b, length, angle: Math.atan2(dz, dx), kind: label(s.kind), threadType: label(s.threadType), stage, walkable: isWalkingStage(stage) };
  });
  const queue = new Uint16Array(nodes.length), visited = new Uint8Array(nodes.length); queue[0] = 0; visited[0] = 1; let count = 1;
  for (let i = 0; i < count; i += 1) for (const id of adjacency[queue[i]]) if (!visited[id]) { visited[id] = 1; queue[count++] = id; }
  if (count !== nodes.length) throw new TypeError('Disconnected prepared spider web');
  const web = { ...normalizeSpiderWeb(data), constructionVersion: 3, radius: 1, nodes, segments }; buildSpatialIndex(web); return web;
}

function buildSpatialIndex(web) {
  const size = 24; const extent = 1.5; const cells = Array.from({ length: size * size }, () => []);
  const cell = value => clamp(Math.floor((value + extent) / (extent * 2) * size), 0, size - 1);
  for (const segment of web.segments) {
    const a = web.nodes[segment.a]; const b = web.nodes[segment.b];
    for (let z = cell(Math.min(a.z, b.z)); z <= cell(Math.max(a.z, b.z)); z += 1) for (let x = cell(Math.min(a.x, b.x)); x <= cell(Math.max(a.x, b.x)); x += 1) cells[z * size + x].push(segment.id);
  }
  Object.defineProperty(web, '_spatial', { value: { size, extent, cells, seen: new Uint32Array(web.segments.length), candidates: new Uint16Array(web.segments.length), stamp: 0, count: 0 }, enumerable: false });
}

/** Shared exact nearest strand projection, optionally clipped to a 3D reach
 * sphere with an excluded inner sphere for unequal-length leg chains.
 * Walking requests exclude upper interception/retreat structures;
 * ordinary pointer/prey projection still addresses every visible strand.
 * A spatial index only discards segments outside the sphere's XZ box. */
export function projectSpiderWebInto(web, x, z, out, cx = 0, cz = 0, reach = Infinity, cy = 0, walkableOnly = false, minReach = 0) {
  const index = web._spatial; let count = web.segments.length; let candidates = null;
  if (index && reach !== Infinity) {
    index.stamp = (index.stamp + 1) >>> 0; if (!index.stamp) { index.seen.fill(0); index.stamp = 1; }
    const scale = index.size / (index.extent * 2); const maxCell = index.size - 1;
    const x0 = clamp(Math.floor((cx - reach + index.extent) * scale), 0, maxCell); const x1 = clamp(Math.floor((cx + reach + index.extent) * scale), 0, maxCell);
    const z0 = clamp(Math.floor((cz - reach + index.extent) * scale), 0, maxCell); const z1 = clamp(Math.floor((cz + reach + index.extent) * scale), 0, maxCell);
    count = 0; candidates = index.candidates;
    for (let iz = z0; iz <= z1; iz += 1) for (let ix = x0; ix <= x1; ix += 1) {
      const entries = index.cells[iz * index.size + ix];
      for (let k = 0; k < entries.length; k += 1) { const id = entries[k]; if (index.seen[id] === index.stamp) continue; index.seen[id] = index.stamp; candidates[count++] = id; }
    }
  }
  const minimum = Math.max(0, finite(minReach));
  if (minimum > reach) count = 0;
  let best = Infinity; let bestId = -1; let bestU = 0; let bestX = 0; let bestY = 0; let bestZ = 0;
  for (let k = 0; k < count; k += 1) {
    const id = candidates ? candidates[k] : k; const segment = web.segments[id];
    if (walkableOnly && segment.walkable === false) continue;
    const a = web.nodes[segment.a]; const b = web.nodes[segment.b];
    const dx = b.x - a.x; const dy = b.y - a.y; const dz = b.z - a.z; const length2 = dx * dx + dz * dz, fullLength2 = length2 + dy * dy;
    if (!(fullLength2 > 1e-16)) continue;
    let lo = 0; let hi = 1;
    if (reach !== Infinity) {
      const ax = a.x - cx; const ay = a.y - cy; const az = a.z - cz;
      const center = -(ax * dx + ay * dy + az * dz) / fullLength2;
      const radial = center * center - (ax * ax + ay * ay + az * az - reach * reach) / fullLength2;
      if (radial < 0) continue;
      const half = Math.sqrt(radial); lo = Math.max(0, center - half); hi = Math.min(1, center + half); if (lo > hi) continue;
    }
    const desired = length2 > 1e-16 ? ((x - a.x) * dx + (z - a.z) * dz) / length2 : (cy - a.y) / dy;
    let u = clamp(desired, lo, hi);
    if (minimum > 0) {
      const ax = a.x - cx; const ay = a.y - cy; const az = a.z - cz;
      const center = -(ax * dx + ay * dy + az * dz) / fullLength2;
      const radial = center * center - (ax * ax + ay * ay + az * az - minimum * minimum) / fullLength2;
      if (radial > 0) {
        const half = Math.sqrt(radial), left = center - half, right = center + half;
        // A strand can cross the forbidden sphere twice. The nearest point
        // lies on either surviving interval, not along a ray from the hip.
        if (u > left && u < right) {
          const hasLeft = left >= lo, hasRight = right <= hi;
          if (!hasLeft && !hasRight) continue;
          u = hasLeft && (!hasRight || Math.abs(desired - left) <= Math.abs(desired - right)) ? left : right;
        }
      }
    }
    const px = a.x + u * dx; const pz = a.z + u * dz;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < best || d === best && id < bestId) { best = d; bestId = id; bestU = u; bestX = px; bestY = a.y + dy * u; bestZ = pz; }
  }
  out.x = bestX; out.y = bestY; out.z = bestZ; out.segmentId = bestId; out.u = bestU; out.distance = Math.sqrt(best);
  return out;
}
export function projectSpiderWebPoint(web, x, z) { return projectSpiderWebInto(web, finite(x), finite(z), {}); }
