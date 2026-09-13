import test from 'node:test';
import assert from 'node:assert/strict';
import { SPIDER_WEB_PRESETS, SPIDER_WEB_PARAMETERS, normalizeSpiderWeb, createSpiderWeb, projectSpiderWebInto } from '../src/spider-synth-web.js';
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
          const foot = frame.feet[i]; const s = web.segments[foot.segmentId]; assert.ok(s);
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
