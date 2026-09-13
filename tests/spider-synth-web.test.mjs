import test from 'node:test';
import assert from 'node:assert/strict';
import { SPIDER_WEB_PRESETS, SPIDER_WEB_PARAMETERS, SPIDER_WEB_CONSTRUCTION_RULES, normalizeSpiderWeb, createSpiderWeb, projectSpiderWebInto, spiderWebGeometryKey, serializeSpiderWeb, hydrateSpiderWeb, spiderWebHeight } from '../src/spider-synth-web.js';
import { SPIDER_MOTION_PRESETS, SPIDER_LEG_GEOMETRY, normalizeSpiderMotion, createSpiderFrame, writeSpiderFrame } from '../src/spider-synth-model.js';
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

test('17 named web networks are connected, finite, deterministic and bounded at knob extremes', () => {
  const signatures = new Set();
  for (const preset of SPIDER_WEB_PRESETS) {
    assert.throws(() => { preset.settings.spokes = 999; }, TypeError);
    for (const extreme of [false, true]) {
      const settings = extreme ? { ...preset.settings, spokes: 24, rings: 16, twist: 1, asymmetry: 1, irregularity: 1, depth: .45, stabilimentum: 1 } : preset.settings;
      const web = createSpiderWeb(settings); assert.deepEqual(web, createSpiderWeb(settings));
      assert.ok(web.nodes.length <= 1200); assert.ok(web.segments.length <= 2400);
      const edges = Array.from({ length: web.nodes.length }, () => []);
      for (let i = 0; i < web.segments.length; i += 1) {
        const s = web.segments[i]; assert.equal(s.id, i); const a = web.nodes[s.a]; const b = web.nodes[s.b]; assert.ok(a && b);
        near(s.length, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); assert.ok(s.length > 0); assert.ok(Number.isFinite(s.angle));
        edges[s.a].push(s.b); edges[s.b].push(s.a);
      }
      const visited = new Set([0]); const queue = [0];
      for (let i = 0; i < queue.length; i += 1) for (const id of edges[queue[i]]) if (!visited.has(id)) { visited.add(id); queue.push(id); }
      assert.equal(visited.size, web.nodes.length, preset.id);
      for (const node of web.nodes) for (const axis of ['x', 'y', 'z']) assert.ok(Number.isFinite(node[axis]) && Math.abs(node[axis]) < 1.5);
      if (!extreme) signatures.add(JSON.stringify([web.nodes, web.segments]));
    }
  }
  assert.equal(signatures.size, 17);
});

test('construction controls are normalized and change physical strand geometry', () => {
  const normalized = normalizeSpiderWeb({ preset: 'argiope', spokes: Infinity, depth: 99, twist: -99, seed: -1 });
  assert.equal(normalized.spokes, 16); assert.equal(normalized.depth, .45); assert.equal(normalized.twist, -1); assert.equal(normalized.seed, 0xffffffff);
  for (const parameter of SPIDER_WEB_PARAMETERS) {
    const a = createSpiderWeb({ preset: 'orb', [parameter.key]: parameter.min }); const b = createSpiderWeb({ preset: 'orb', [parameter.key]: parameter.max });
    assert.notDeepEqual([a.nodes, a.segments], [b.nodes, b.segments], parameter.key);
  }
  const plain = createSpiderWeb({ preset: 'orb' }); const writing = createSpiderWeb({ preset: 'argiope' });
  assert.ok(writing.segments.some(s => s.kind === 'stabilimentum'));
  assert.ok(!plain.segments.some(s => s.kind === 'stabilimentum'));
  const markers = writing.segments.filter(s => s.kind === 'stabilimentum').map(s => writing.nodes[s.b]);
  assert.ok(markers.some(p => p.z > .1) && markers.some(p => p.z < -.1));
});

test('spatial lookup preserves exact 3D strand projection and reach clipping against brute force', () => {
  const indexed = {}; const brute = {};
  for (const preset of SPIDER_WEB_PRESETS) {
    const web = createSpiderWeb({ ...preset.settings, spokes: 24, rings: 16 }); const unindexed = { ...web };
    for (let i = 0; i < 40; i += 1) {
      const x = Math.sin(i * 1.73) * .55; const z = Math.cos(i * 2.17) * .55; const cy = web.depth ? -.1 : 0;
      projectSpiderWebInto(web, x + .12, z -.06, indexed, x, z, .3, cy); projectSpiderWebInto(unindexed, x + .12, z - .06, brute, x, z, .3, cy);
      assert.deepEqual(indexed, brute);
      if (indexed.segmentId < 0) continue;
      const segment = web.segments[indexed.segmentId]; const a = web.nodes[segment.a]; const b = web.nodes[segment.b];
      for (const axis of ['x', 'y', 'z']) near(indexed[axis], a[axis] + (b[axis] - a[axis]) * indexed.u);
      assert.ok(Math.hypot(indexed.x - x, indexed.y - cy, indexed.z - z) <= .3 + 1e-9);
    }
  }
});

test('all 40 routines keep exact reachable web contacts across every default construction', () => {
  const frame = createSpiderFrame();
  for (const family of SPIDER_WEB_PRESETS) {
    const web = createSpiderWeb(family.settings);
    for (const preset of SPIDER_MOTION_PRESETS) {
      const motion = normalizeSpiderMotion({ preset: preset.id, intensity: 1, tempo: 108 });
      for (let tick = 0; tick < 32; tick += 1) {
        writeSpiderFrame(tick * .171, motion, web, frame);
        assert.ok(frame.supportCount >= 4 || frame.airborne && preset.support, `${family.id}/${preset.id}`);
        for (let i = 0; i < 8; i += 1) {
          const foot = frame.feet[i]; const s = web.segments[foot.segmentId]; assert.ok(s, `${family.id}/${preset.id}/${tick}/${i}: missing strand`);
          if (foot.stance) for (const axis of ['x', 'y', 'z']) near(foot[axis], web.nodes[s.a][axis] + (web.nodes[s.b][axis] - web.nodes[s.a][axis]) * foot.u);
          if (frame.airborne) { assert.equal(foot.airborne, true); assert.equal(foot.impact, 0); continue; }
          const g = SPIDER_LEG_GEOMETRY[i]; const c = Math.cos(frame.body.yaw); const sn = Math.sin(frame.body.yaw);
          const d = Math.hypot(foot.x - frame.body.x - g.hip[0] * c - g.hip[2] * sn, foot.y - frame.body.y - g.hip[1], foot.z - frame.body.z - g.hip[2] * c + g.hip[0] * sn);
          assert.ok(d < g.reach, `${family.id}/${preset.id}/${i}: ${d / g.reach}`);
        }
      }
    }
  }
});

test('construction rules distinguish documented natural motifs from authored artistic networks', () => {
  assert.deepEqual(Object.keys(SPIDER_WEB_CONSTRUCTION_RULES), SPIDER_WEB_PRESETS.map(p => p.id));
  for (const preset of SPIDER_WEB_PRESETS) {
    const rule = SPIDER_WEB_CONSTRUCTION_RULES[preset.id];
    assert.ok(rule.stages.length >= 3 && rule.limit.length > 20);
    if (rule.basis === 'natural approximation') assert.ok(rule.sources.length > 0, preset.id);
    else { assert.equal(rule.basis, 'artistic'); assert.match(preset.label, /^Artistic/); }
  }
});

test('an orb has a connected open capture spiral, unequal rays, a dry hub and separate frame', () => {
  const web = createSpiderWeb({ preset: 'orb', irregularity: .65 });
  const hub = web.nodes.find(p => p.role === 'hub');
  const capture = web.segments.filter(s => s.threadType === 'capture'), degree = new Map();
  for (const s of capture) for (const id of [s.a, s.b]) degree.set(id, (degree.get(id) || 0) + 1);
  assert.equal([...degree.values()].filter(d => d === 1).length, 2, 'one open spiral has two ends');
  assert.ok([...degree.values()].every(d => d <= 2));
  assert.equal(capture.length, degree.size - 1);
  const radii = web.nodes.filter(p => p.role === 'frame-junction');
  const angles = radii.map(p => Math.atan2(p.z - hub.z, p.x - hub.x)).sort((a, b) => a - b);
  const gaps = angles.map((v, i) => ((angles[(i + 1) % angles.length] - v) + Math.PI * 2) % (Math.PI * 2));
  assert.ok(Math.max(...gaps) / Math.min(...gaps) > 1.3);
  const lengths = radii.map(p => Math.hypot(p.x - hub.x, p.z - hub.z));
  assert.ok(Math.max(...lengths) / Math.min(...lengths) > 1.15);
  const dryRadius = Math.max(...web.nodes.filter(p => p.role === 'hub').map(p => Math.hypot(p.x - hub.x, p.z - hub.z)));
  const captureRadius = Math.min(...[...degree.keys()].map(id => Math.hypot(web.nodes[id].x - hub.x, web.nodes[id].z - hub.z)));
  assert.ok(captureRadius > dryRadius * 1.3, 'free zone separates hub from capture silk');
  assert.equal(web.nodes.filter(p => p.role === 'anchor').length, web.anchors);
  assert.ok(web.segments.filter(s => s.stage === 'frame').every(s => s.threadType === 'dry'));
});

test('eccentric capture has a larger lower area and partial traverses, while the retreat sector stays open', () => {
  const web = createSpiderWeb({ preset: 'eccentric' }), hub = web.nodes.find(n => n.role === 'hub');
  const capture = web.nodes.filter(n => n.role.startsWith('capture'));
  assert.ok(hub.z > .15);
  assert.ok(hub.z - Math.min(...capture.map(n => n.z)) > Math.max(...capture.map(n => n.z)) - hub.z);
  assert.ok(web.segments.some(s => s.stage === 'capture-return'));
  assert.ok(web.nodes.filter(n => n.role === 'capture-return').every(n => n.z < hub.z));
  const sector = createSpiderWeb({ preset: 'missing-sector' }), signal = sector.segments.filter(s => s.threadType === 'signal');
  assert.equal(signal.length, 1); assert.equal(sector.nodes[signal[0].b].role, 'retreat');
  const center = sector.nodes[signal[0].a];
  for (const s of sector.segments.filter(s => s.threadType === 'capture')) {
    const a = sector.nodes[s.a], b = sector.nodes[s.b], angle = Math.atan2((a.z + b.z) / 2 - center.z, (a.x + b.x) / 2 - center.x);
    assert.ok(Math.abs(Math.atan2(Math.sin(angle - .45), Math.cos(angle - .45))) > .3, 'capture thread crosses free sector');
  }
});

test('sheet, off-center funnel, bowl, tangle and triangle use genuinely different supports', () => {
  const sheet = createSpiderWeb({ preset: 'sheet' });
  assert.ok(sheet.nodes.filter(n => n.role === 'sheet-junction').length > 100);
  assert.ok(!sheet.nodes.some(n => n.role === 'hub'));
  assert.ok(sheet.segments.filter(s => s.stage === 'sheet').every(s => s.threadType === 'dry'));
  assert.ok(sheet.segments.some(s => s.stage === 'interception'));
  const funnel = createSpiderWeb({ preset: 'funnel' }), tube = funnel.nodes.filter(n => n.role === 'retreat');
  assert.ok(tube.length > 30); assert.ok(Math.max(...tube.map(n => n.x)) - Math.min(...tube.map(n => n.x)) > .4);
  assert.ok(spiderWebHeight(funnel, .48, -.38) < spiderWebHeight(funnel, 0, 0) - .2);
  const bowl = createSpiderWeb({ preset: 'bowl' }), dome = createSpiderWeb({ preset: 'dome' });
  assert.ok(spiderWebHeight(bowl, 0, 0) < spiderWebHeight(bowl, .7, 0));
  assert.ok(spiderWebHeight(dome, 0, 0) > spiderWebHeight(dome, .7, 0));
  const tangle = createSpiderWeb({ preset: 'tangle' });
  assert.ok(tangle.segments.some(s => s.threadType === 'gumfoot'));
  assert.ok(!tangle.nodes.some(n => n.role === 'hub' || n.role === 'capture-junction'));
  assert.ok(Math.max(...tangle.nodes.map(n => n.y)) - Math.min(...tangle.nodes.map(n => n.y)) > .3);
  const triangle = createSpiderWeb({ preset: 'triangle' }), hub = triangle.nodes.find(n => n.role === 'hub');
  assert.equal(triangle.segments.filter(s => s.a === hub.id && s.stage === 'radii').length, 4);
  const ladder = createSpiderWeb({ preset: 'ladder' });
  const width = Math.max(...ladder.nodes.map(n => n.x)) - Math.min(...ladder.nodes.map(n => n.x));
  const height = Math.max(...ladder.nodes.map(n => n.z)) - Math.min(...ladder.nodes.map(n => n.z));
  assert.ok(height > width * 2);
});

test('shared hexagonal junctions have degree three instead of a disguised rectangular lattice', () => {
  const web = createSpiderWeb({ preset: 'honeycomb' }), degree = new Map();
  for (const s of web.segments.filter(s => s.stage === 'cells')) for (const id of [s.a, s.b]) degree.set(id, (degree.get(id) || 0) + 1);
  assert.ok([...degree.values()].filter(d => d === 3).length > 15);
  assert.ok([...degree.values()].every(d => d === 2 || d === 3));
});

test('prepared graphs hydrate identically without sharing mutable arrays and reject malformed graphs', () => {
  for (const preset of SPIDER_WEB_PRESETS) {
    const web = createSpiderWeb({ ...preset.settings, spokes: 24, rings: 16 });
    const prepared = serializeSpiderWeb(web), before = JSON.stringify(prepared), loaded = hydrateSpiderWeb(prepared);
    assert.deepEqual(loaded, web); assert.equal(JSON.stringify(prepared), before);
    assert.notEqual(loaded.nodes, prepared.nodes); assert.notEqual(loaded.nodes[0], prepared.nodes[0]);
    assert.equal(spiderWebGeometryKey(loaded), spiderWebGeometryKey(web));
    assert.equal(spiderWebGeometryKey(web), spiderWebGeometryKey({ ...web, tension: 4 }));
    for (let i = 0; i < 8; i += 1) {
      const a = {}, b = {}, x = Math.sin(i) * .5, z = Math.cos(i) * .5;
      projectSpiderWebInto(web, x, z, a, x, z, .3); projectSpiderWebInto(loaded, x, z, b, x, z, .3); assert.deepEqual(a, b);
    }
  }
  const good = serializeSpiderWeb(createSpiderWeb({ preset: 'orb' }));
  for (const change of [p => { p.nodes[0].x = NaN; }, p => { p.segments[0].a = 1200; }, p => { p.nodes.push({ id: p.nodes.length, x: 0, y: 0, z: 0 }); }, p => { p.segments.push({ ...p.segments[0], id: p.segments.length }); }, p => { p.constructionVersion = 2; }]) {
    const bad = structuredClone(good); change(bad); assert.throws(() => hydrateSpiderWeb(bad), TypeError);
  }
  for (const p of SPIDER_WEB_PARAMETERS) assert.notEqual(spiderWebGeometryKey({ ...good, [p.key]: p.min }), spiderWebGeometryKey({ ...good, [p.key]: p.max }), p.key);
});

test('purely vertical silk remains projectable within a three-dimensional reach sphere', () => {
  const web = { nodes: [{ x: .2, y: -.5, z: .3 }, { x: .2, y: .5, z: .3 }], segments: [{ id: 0, a: 0, b: 1 }] }, out = {};
  projectSpiderWebInto(web, .2, .3, out, .2, .3, .12, .1);
  assert.equal(out.segmentId, 0); near(out.y, .1); near(out.u, .6); near(out.distance, 0);
});

test('three-anchor extreme frames enclose their hub across one hundred deterministic seeds', () => {
  for (const family of SPIDER_WEB_PRESETS) for (let seed = 1; seed <= 100; seed += 1) {
    const web = createSpiderWeb({ ...family.settings, seed, anchors: 3, spokes: seed % 3 ? 24 : 8, rings: seed % 3 ? 16 : 3,
      asymmetry: 1, irregularity: 1, twist: seed % 2 ? -1 : 1, spacing: seed % 2, depth: .45, stabilimentum: 1 });
    assert.ok(web.nodes.every(p => ['x', 'y', 'z'].every(axis => Number.isFinite(p[axis]) && Math.abs(p[axis]) < 1.5)), `${family.id}/${seed}`);
    // Hydration checks every graph junction is actually connected, not merely
    // visually crossing another strand or hidden behind an invalid number.
    assert.equal(hydrateSpiderWeb(serializeSpiderWeb(web)).nodes.length, web.nodes.length);
  }
});

test('walking projection excludes upper interception and retreat geometry while direct projection retains it', () => {
  const out = {}, web = { nodes: [{ x: -.5, y: 0, z: 0 }, { x: .5, y: 0, z: 0 }, { x: -.5, y: .1, z: .1 }, { x: .5, y: .1, z: .1 }],
    segments: [{ id: 0, a: 0, b: 1, walkable: true }, { id: 1, a: 2, b: 3, walkable: false }] };
  projectSpiderWebInto(web, 0, .1, out, 0, .1, .3, .1); assert.equal(out.segmentId, 1);
  projectSpiderWebInto(web, 0, .1, out, 0, .1, .3, .1, true); assert.equal(out.segmentId, 0); near(out.y, 0);
  for (const preset of ['sheet', 'bowl', 'dome', 'funnel']) {
    const built = createSpiderWeb({ preset }), prepared = serializeSpiderWeb(built), hydrated = hydrateSpiderWeb(prepared);
    const excluded = hydrated.segments.filter(s => ['interception', 'suspension', 'retreat'].includes(s.stage));
    assert.ok(excluded.length > 0); assert.ok(excluded.every(s => s.walkable === false));
    for (let i = 0; i < 20; i += 1) {
      const x = Math.sin(i) * .5, z = Math.cos(i) * .5;
      projectSpiderWebInto(hydrated, x, z, out, x, z, .35, spiderWebHeight(hydrated, x, z), true);
      assert.ok(out.segmentId >= 0 && hydrated.segments[out.segmentId].walkable);
    }
  }
});

test('unequal leg chains project to either exact reachable annulus interval without moving an accepted point', () => {
  const web = { nodes: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], segments: [{ id: 0, a: 0, b: 1, walkable: true }] }, out = {};
  for (const target of [-.1, .1]) {
    projectSpiderWebInto(web, target, 0, out, 0, 0, .7, 0, true, .3);
    near(out.x, Math.sign(target) * .3); near(out.y, 0); near(out.distance, .2);
  }
  projectSpiderWebInto(web, .5, 0, out, 0, 0, .7, 0, true, .3); near(out.x, .5);
  projectSpiderWebInto(web, .9, 0, out, 0, 0, .7, 0, true, .3); near(out.x, .7);
  projectSpiderWebInto(web, 0, 0, out, 0, 0, .2, 0, true, .3); assert.equal(out.segmentId, -1);
  const inside = { nodes: [{ x: -.1, y: 0, z: 0 }, { x: .1, y: 0, z: 0 }], segments: web.segments };
  projectSpiderWebInto(inside, 0, 0, out, 0, 0, .7, 0, true, .3); assert.equal(out.segmentId, -1);
  const oneSide = { nodes: [{ x: -.1, y: 0, z: 0 }, { x: .8, y: 0, z: 0 }], segments: web.segments };
  projectSpiderWebInto(oneSide, -.1, 0, out, 0, 0, .7, 0, true, .3); near(out.x, .3);
});

test('inner reach clips real XYZ distance for elevated, slanted, vertical, and tangent silk', () => {
  const out = {}, segments = [{ id: 0, a: 0, b: 1, walkable: true }];
  const elevated = { nodes: [{ x: -1, y: .3, z: 0 }, { x: 1, y: .3, z: 0 }], segments };
  projectSpiderWebInto(elevated, .05, 0, out, 0, 0, .7, 0, true, .5);
  near(out.x, .4); near(Math.hypot(out.x, out.y, out.z), .5);
  const slanted = { nodes: [{ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }], segments };
  projectSpiderWebInto(slanted, .01, .01, out, .1, .1, .7, .1, true, .3);
  near(out.x, .1 - .3 / Math.sqrt(3)); near(Math.hypot(out.x - .1, out.y - .1, out.z - .1), .3);
  const vertical = { nodes: [{ x: .2, y: -.5, z: .3 }, { x: .2, y: .5, z: .3 }], segments };
  projectSpiderWebInto(vertical, .2, .3, out, .2, .3, .3, .1, true, .15);
  near(Math.abs(out.y - .1), .15); near(out.distance, 0);
  const tangent = { nodes: [{ x: -1, y: .5, z: 0 }, { x: 1, y: .5, z: 0 }], segments };
  projectSpiderWebInto(tangent, 0, 0, out, 0, 0, .7, 0, true, .5); near(out.x, 0); near(out.y, .5);
});

test('indexed annulus projection matches full graph search with defaults unchanged', () => {
  for (const preset of SPIDER_WEB_PRESETS) {
    const web = createSpiderWeb(preset.settings), unindexed = { nodes: web.nodes, segments: web.segments }, a = {}, b = {}, old = {};
    for (let i = 0; i < 24; i += 1) {
      const x = Math.sin(i * 1.3) * .7, z = Math.cos(i * .6) * .7, cy = spiderWebHeight(web, x, z) + .1;
      projectSpiderWebInto(web, x + .04, z - .02, a, x, z, .3, cy, true, .125);
      projectSpiderWebInto(unindexed, x + .04, z - .02, b, x, z, .3, cy, true, .125);
      assert.deepEqual(a, b);
      if (a.segmentId >= 0) {
        const radius = Math.hypot(a.x - x, a.y - cy, a.z - z);
        assert.ok(radius >= .125 - 1e-9 && radius <= .3 + 1e-9, `${preset.id}/${i}: ${radius}`);
      }
      projectSpiderWebInto(web, x, z, a, x, z, .3, cy, true);
      projectSpiderWebInto(web, x, z, old, x, z, .3, cy, true, 0);
      assert.deepEqual(a, old);
    }
  }
});
