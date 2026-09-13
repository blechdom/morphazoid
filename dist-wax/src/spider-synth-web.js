/** Bounded authored web networks. Family labels describe geometry, not a
 * claim that the scanned Argiope builds every construction in this instrument. */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
function freeze(value) { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); }
function rng(seed) { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) | 0; let v = Math.imul(state ^ state >>> 15, state | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61); return ((v ^ v >>> 14) >>> 0) / 4294967296; }; }
const family = (id, label, settings, basis) => ({ id, label, settings: { preset: id, ...settings }, basis });
export const SPIDER_WEB_PRESETS = freeze([
  family('argiope', 'Argiope · writing spider', { stabilimentum: .65 }, 'Argiope aurantia inspired'),
  family('orb', 'Orb · capture rings', {}, 'orb approximation'),
  family('spiral', 'Continuous spiral', { twist: .25 }, 'orb inspired'),
  family('eccentric', 'Off-center orb', { asymmetry: .7 }, 'orb inspired'),
  family('missing-sector', 'Missing sector', { asymmetry: .3 }, 'sector-web inspired'),
  family('ladder', 'Ladder', { rings: 14, spokes: 12 }, 'ladder-web inspired'),
  family('sheet', 'Woven sheet', { spokes: 18, rings: 12 }, 'sheet inspired'),
  family('funnel', 'Funnel', { depth: .28, rings: 14 }, 'funnel inspired'),
  family('bowl', 'Silken bowl', { depth: .24 }, 'bowl inspired'),
  family('dome', 'Silken dome', { depth: .2 }, 'dome inspired'),
  family('tangle', 'Tangled threads', { irregularity: .65, depth: .18 }, 'tangle inspired'),
  family('triangle', 'Triangle', { spokes: 18 }, 'triangle-web inspired'),
  family('lace', 'Diagonal lace', { irregularity: .12 }, 'artistic'),
  family('wheel', 'Double-spoke wheel', { spokes: 12, rings: 7 }, 'artistic'),
  family('star', 'Scalloped star', { twist: .15 }, 'artistic'),
  family('honeycomb', 'Honeycomb silk', { rings: 12 }, 'artistic'),
  family('constellation', 'Constellation', { irregularity: .8, twist: -.3 }, 'artistic'),
]);
export const SPIDER_WEB_PARAMETERS = freeze([
  { key: 'spokes', label: 'Struts', min: 8, max: 24, step: 1, default: 16 },
  { key: 'rings', label: 'Rows / rings', min: 3, max: 16, step: 1, default: 10 },
  { key: 'asymmetry', label: 'Asymmetry', min: 0, max: 1, step: .01, default: 0 },
  { key: 'twist', label: 'Twist', min: -1, max: 1, step: .01, default: 0 },
  { key: 'irregularity', label: 'Irregularity', min: 0, max: 1, step: .01, default: 0 },
  { key: 'depth', label: 'Depth', min: 0, max: .45, step: .01, default: 0 },
  { key: 'stabilimentum', label: 'Writing zigzag', min: 0, max: 1, step: .01, default: 0 },
]);
export function normalizeSpiderWeb(input = {}) {
  const preset = SPIDER_WEB_PRESETS.find(item => item.id === input.preset) || SPIDER_WEB_PRESETS[1];
  const settings = { ...preset.settings, ...input };
  const out = { preset: preset.id, tension: clamp(finite(settings.tension, 1), .2, 4), seed: finite(settings.seed, 1) >>> 0 };
  for (const p of SPIDER_WEB_PARAMETERS) out[p.key] = clamp(finite(settings[p.key], p.default), p.min, p.max);
  out.spokes = Math.round(out.spokes); out.rings = Math.round(out.rings);
  return out;
}

/** Smooth support surface underlying the actual strands. Contact height is
 * always interpolated on the selected segment, never taken from this helper. */
export function spiderWebHeight(web, x, z) {
  const d = web.depth || 0; if (!d) return 0;
  const r = Math.min(1, Math.hypot(x, z));
  if (web.preset === 'funnel') return -d * Math.exp(-r * r * 7);
  if (web.preset === 'dome') return d * (1 - r * r);
  if (web.preset === 'bowl') return d * (r * r - .5);
  if (web.preset === 'tangle') return d * .35 * Math.sin(x * 4) * Math.cos(z * 4);
  return d * .25 * Math.sin(x * 3 + z * 2);
}

export function createSpiderWeb(input = {}) {
  const settings = normalizeSpiderWeb(input); const { preset, spokes, rings, seed, asymmetry, twist, irregularity } = settings;
  const random = rng(seed); const nodes = []; const segments = []; const pairs = new Set();
  const addNode = (x, z) => {
    const r = Math.hypot(x, z); const angle = twist * r * .65; const c = Math.cos(angle); const s = Math.sin(angle);
    const px = x * c - z * s; const pz = x * s + z * c;
    x = px * (1 - asymmetry * .14) + asymmetry * .13 * (1 - Math.min(1, r)); z = pz;
    if (irregularity && r > .02 && r < .96) { x += (random() - .5) * irregularity * .06; z += (random() - .5) * irregularity * .06; }
    nodes.push({ id: nodes.length, x, y: spiderWebHeight(settings, x, z), z }); return nodes.length - 1;
  };
  const add = (a, b, kind) => {
    if (a === b || a < 0 || b < 0) return;
    const key = Math.min(a, b) * 1200 + Math.max(a, b); if (pairs.has(key)) return; pairs.add(key);
    const dx = nodes[b].x - nodes[a].x; const dy = nodes[b].y - nodes[a].y; const dz = nodes[b].z - nodes[a].z;
    if (Math.hypot(dx, dy, dz) < 1e-7) return;
    segments.push({ id: segments.length, a, b, length: Math.hypot(dx, dy, dz), angle: Math.atan2(dz, dx), kind });
  };
  const grid = ['ladder', 'sheet', 'lace', 'honeycomb'].includes(preset);
  if (grid) {
    const cols = preset === 'ladder' ? Math.max(4, Math.round(spokes / 2)) : spokes; const rows = rings;
    for (let row = 0; row <= rows; row += 1) for (let col = 0; col <= cols; col += 1) {
      const x = (col / cols - .5) * 1.64; const z = (row / rows - .5) * 1.64;
      addNode(x + (preset === 'honeycomb' && col > 0 && col < cols ? (row % 2) * .5 / cols : 0), z);
    }
    for (let row = 0; row <= rows; row += 1) for (let col = 0; col <= cols; col += 1) {
      const i = row * (cols + 1) + col;
      if (col < cols) add(i, i + 1, row === 0 || row === rows ? 'frame' : 'spiral');
      if (row < rows && (preset !== 'honeycomb' || (row + col) % 2 === 0 || col === 0 || col === cols)) add(i, i + cols + 1, col === 0 || col === cols ? 'frame' : 'radial');
      if (preset === 'lace' && row < rows && col < cols) add(i, i + cols + 2, 'spiral');
    }
  } else {
    addNode(0, 0);
    // This preserves the original orb's seed, topology, node positions and IDs.
    const phase = (random() - .5) * TAU / spokes * .22;
    for (let ring = 1; ring <= rings; ring += 1) for (let spoke = 0; spoke < spokes; spoke += 1) {
      const angle = phase + TAU * spoke / spokes;
      let radius = ring / rings;
      if (preset === 'spiral' && ring < rings) radius = (ring - .8 + spoke / spokes * .8) / rings;
      if (preset === 'star') radius *= .82 + .18 * Math.cos(angle * 5);
      if (preset === 'triangle') radius *= .66 / Math.cos(((angle + Math.PI / 3) % (TAU / 3) + TAU / 3) % (TAU / 3) - Math.PI / 3);
      addNode(Math.sin(angle) * radius, Math.cos(angle) * radius);
    }
    for (let ring = 1; ring <= rings; ring += 1) for (let spoke = 0; spoke < spokes; spoke += 1) {
      const i = 1 + (ring - 1) * spokes + spoke; const next = 1 + (ring - 1) * spokes + (spoke + 1) % spokes;
      add(ring === 1 ? 0 : i - spokes, i, 'radial');
      const gap = preset === 'missing-sector' && spoke < Math.max(1, Math.floor(spokes / 6));
      if ((ring === rings || !gap) && !(preset === 'spiral' && ring === rings - 1 && spoke === spokes - 1)) add(i, preset === 'spiral' && spoke === spokes - 1 && ring < rings - 1 ? next + spokes : next, ring === rings ? 'frame' : 'spiral');
      if (preset === 'wheel' && ring > 1 && spoke % 2 === 0) add(i - spokes, next, 'radial');
      if ((preset === 'tangle' || preset === 'constellation') && ring > 1) add(i - spokes, 1 + (ring - 1) * spokes + (spoke + (preset === 'tangle' ? 3 : 2)) % spokes, 'spiral');
    }
  }
  if (settings.stabilimentum > 0) {
    const baseCount = nodes.length; const count = 12 + Math.round(settings.stabilimentum * 24); const span = .15 + settings.stabilimentum * .55;
    let previous = -1;
    for (let i = 0; i <= count; i += 1) {
      const z = (i / count - .5) * span; const x = (i % 2 ? 1 : -1) * (.012 + Math.abs(z) * .06) * settings.stabilimentum;
      const id = addNode(x, z); if (previous >= 0) add(previous, id, 'stabilimentum');
      if (i === 0 || i === count || i === Math.floor(count / 2)) {
        let nearest = 0; let distance = Infinity;
        for (let n = 0; n < baseCount; n += 1) { const d = Math.hypot(nodes[n].x - nodes[id].x, nodes[n].z - nodes[id].z); if (d < distance) { distance = d; nearest = n; } }
        add(nearest, id, 'stabilimentum');
      }
      previous = id;
    }
  }
  const web = { ...settings, nodes, segments, radius: 1 };
  buildSpatialIndex(web);
  return web;
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
 * sphere. A spatial index only discards segments outside the sphere's XZ box. */
export function projectSpiderWebInto(web, x, z, out, cx = 0, cz = 0, reach = Infinity, cy = 0) {
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
  let best = Infinity; let bestId = -1; let bestU = 0; let bestX = 0; let bestY = 0; let bestZ = 0;
  for (let k = 0; k < count; k += 1) {
    const id = candidates ? candidates[k] : k; const segment = web.segments[id]; const a = web.nodes[segment.a]; const b = web.nodes[segment.b];
    const dx = b.x - a.x; const dy = b.y - a.y; const dz = b.z - a.z; const length2 = dx * dx + dz * dz;
    if (!(length2 > 1e-16)) continue;
    let lo = 0; let hi = 1;
    if (reach !== Infinity) {
      const ax = a.x - cx; const ay = a.y - cy; const az = a.z - cz; const fullLength2 = length2 + dy * dy;
      const center = -(ax * dx + ay * dy + az * dz) / fullLength2;
      const radial = center * center - (ax * ax + ay * ay + az * az - reach * reach) / fullLength2;
      if (radial < 0) continue;
      const half = Math.sqrt(radial); lo = Math.max(0, center - half); hi = Math.min(1, center + half); if (lo > hi) continue;
    }
    const u = clamp(((x - a.x) * dx + (z - a.z) * dz) / length2, lo, hi); const px = a.x + u * dx; const pz = a.z + u * dz;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < best || d === best && id < bestId) { best = d; bestId = id; bestU = u; bestX = px; bestY = a.y + dy * u; bestZ = pz; }
  }
  out.x = bestX; out.y = bestY; out.z = bestZ; out.segmentId = bestId; out.u = bestU; out.distance = Math.sqrt(best);
  return out;
}
export function projectSpiderWebPoint(web, x, z) { return projectSpiderWebInto(web, finite(x), finite(z), {}); }
