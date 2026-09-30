import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATERIALS, LAYOUTS, DEFAULT_PARAMS, PRESETS, sanitizeParams, sceneParams, randomizeParams,
  buildRun, compileRun, contactGeometry, angleAt,
} from '../src/instruments/domino-run/domino-run-model.js';

const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const block = (id, x, overrides = {}) => ({ id, x, z: 0, elevation: 0, height: 1.2,
  width: .6, depth: .192, angle: 0, material: 'wood', color: '#fff', ...overrides });
const pair = (a, b) => ({ dominoes: [a, b], links: [{ from: a.id, to: b.id }], roots: [a.id] });
const fullKeys = Object.keys(DEFAULT_PARAMS).sort();

function assertCausal(run, score) {
  assert.ok(score.events.length <= run.dominoes.length * 3);
  assert.ok(score.falls.length <= run.dominoes.length);
  assert.equal(new Set(score.falls.map(f => f.id)).size, score.falls.length);
  assert.ok(Number.isFinite(score.duration));
  for (let i = 0; i < score.events.length; i++) {
    const e = score.events[i];
    assert.ok(Number.isFinite(e.time) && e.time >= 0);
    assert.ok(Number.isFinite(e.energy) && e.energy > 0 && e.energy <= 1.5);
    assert.ok(i === 0 || e.time >= score.events[i - 1].time);
  }
  for (const f of score.falls) {
    assert.ok(Number.isFinite(f.duration) && f.duration > 0);
    if (!run.roots.includes(f.id)) assert.ok(score.events.some(e => e.type === 'contact' && e.targetId === f.id && Math.abs(e.time - f.start) < 1e-8), `uncaused fall ${f.id}`);
  }
}

test('sanitization yields complete bounded state without mutating inputs', () => {
  assert.deepEqual(sanitizeParams(null), DEFAULT_PARAMS);
  assert.deepEqual(sanitizeParams({}), DEFAULT_PARAMS);
  const input = Object.freeze({ count: Infinity, spacing: 9, size: -1, sizeVariation: 9,
    growth: -9, stairRise: 9, speed: -8, ring: NaN, brightness: 8,
    material: 'unknown', layout: 'unknown', seed: -1, loop: false });
  const p = sanitizeParams(input);
  assert.deepEqual(Object.keys(p).sort(), fullKeys);
  assert.equal(p.count, DEFAULT_PARAMS.count);
  assert.equal(p.spacing, 2.5); assert.equal(p.size, .1);
  assert.equal(p.sizeVariation, 1); assert.equal(p.growth, -2);
  assert.equal(p.stairRise, 1); assert.equal(p.speed, .05);
  assert.equal(p.ring, DEFAULT_PARAMS.ring); assert.equal(p.brightness, 1);
  assert.equal(p.seed, 4294967295); assert.equal(p.loop, false);
  assert.equal(p.material, 'stone'); assert.equal(p.layout, 'henge');
});

test('seeded routes and contact scores are reproducible and pure', () => {
  const input = Object.freeze({ ...DEFAULT_PARAMS, layout: 'fork', count: 97, seed: 3882 });
  const first = buildRun(input), second = buildRun(input);
  assert.deepEqual(first, second);
  const saved = structuredClone(first);
  assert.deepEqual(compileRun(first), compileRun(second));
  assert.deepEqual(first, saved);
  assert.notDeepEqual(buildRun({ ...input, seed: 3883 }), first);
});

test('all complete scenes propagate from their physical roots', () => {
  assert.ok(PRESETS.length >= 12);
  assert.equal(new Set(PRESETS.map(p => p.name)).size, PRESETS.length);
  assert.equal(new Set(PRESETS.map(p => JSON.stringify(p.params))).size, PRESETS.length);
  assert.equal(PRESETS[0].name, 'Tone Henge');
  assert.equal(PRESETS[0].params.material, 'stone');
  for (const p of PRESETS) {
    assert.deepEqual(Object.keys(p.params).sort(), fullKeys);
    const run = buildRun(p.params), score = compileRun(run);
    assert.equal(score.reachableCount, run.dominoes.length, p.id);
    assert.equal(score.stalledIds.length, 0, p.id);
    if (p.params.direction === 'forward') assert.deepEqual(run.roots, [0]);
    assertCausal(run, score);
  }
});

test('established layouts retain full propagation and contact geometry at their former endpoints', () => {
  for (const id of ['henge', 'serpentine', 'spiral', 'fork', 'stairs-up', 'stairs-down', 'tapestry']) for (const count of [16, 512]) {
    const run = buildRun({ layout: id, count }), score = compileRun(run);
    assert.equal(run.dominoes.length, count, id);
    assert.equal(run.links.length, id === 'henge' ? count : count - 1, id);
    assert.equal(score.reachableCount, count, `${id}/${count}`);
    assert.equal(new Set(run.dominoes.map(d => d.id)).size, count);
    for (const d of run.dominoes) {
      for (const key of ['x', 'z', 'elevation', 'height', 'width', 'depth', 'angle']) assert.ok(Number.isFinite(d[key]));
      close(d.width / d.height, .5); close(d.depth / d.height, .16);
      assert.ok(MATERIALS.some(m => m.id === d.material));
    }
    for (const link of run.links) {
      const a = run.dominoes[link.from], b = run.dominoes[link.to];
      assert.ok(Math.max(a.height, b.height) / Math.min(a.height, b.height) <= 1.18 + 1e-9);
      assert.equal(contactGeometry(a, b).reachable, true);
    }
  }
});

test('serpentine progresses through new rows instead of retracing one racetrack', () => {
  const run = buildRun({ layout: 'serpentine', count: 256, sizeVariation: 0 });
  const positions = run.dominoes.map(d => `${d.x.toFixed(4)},${d.z.toFixed(4)}`);
  assert.equal(new Set(positions).size, run.dominoes.length);
  assert.ok(run.bounds.depth > run.dominoes[0].height * 15);
});

test('equal straight blocks contact at the independently computed pivot angle', () => {
  const a = block(0, 0), b = block(1, .72);
  const g = contactGeometry(a, b);
  assert.equal(g.reachable, true);
  const expected = Math.asin((b.x - a.x - (a.depth + b.depth) / 2) / a.height);
  close(g.angle, expected, 2e-8);
  assert.ok(g.contactHeight > 0 && g.contactHeight <= b.height);
});

test('unreachable gaps, sideways misses and reverse-facing routes do not invent contacts', () => {
  const a = block(0, 0);
  for (const b of [block(1, 2), block(1, .7, { z: 2 }), block(1, -.7), block(1, .6, { elevation: 2 })]) {
    assert.equal(contactGeometry(a, b).reachable, false);
    const score = compileRun(pair(a, b));
    assert.equal(score.reachableCount, 1);
    assert.equal(score.events.filter(e => e.type === 'contact').length, 0);
    assert.deepEqual(score.stalledIds, [1]);
  }
  assert.equal(contactGeometry(a, block(1, .05)).reason, 'standing overlap');
});

test('contacts and floor impacts use exactly the same angle timeline as the renderer', () => {
  const run = buildRun({ layout: 'fork', count: 64 }), score = compileRun(run);
  const falls = new Map(score.falls.map(f => [f.id, f]));
  for (const e of score.events) {
    const f = falls.get(e.id);
    if (e.type === 'floor') close(angleAt(f, e.time), Math.PI / 2);
    else {
      const geometry = contactGeometry(run.dominoes[e.id], run.dominoes[e.targetId]);
      close(angleAt(f, e.time), geometry.angle);
      close(falls.get(e.targetId).start, e.time);
    }
  }
  for (const f of score.falls) {
    assert.equal(angleAt(f, f.start - 1), 0);
    assert.equal(angleAt(f, f.start + f.duration + 1), Math.PI / 2);
    let prior = 0;
    for (let i = 0; i <= 100; i++) {
      const angle = angleAt(f, f.start + f.duration * i / 100);
      assert.ok(angle >= prior - 1e-12 && angle <= Math.PI / 2); prior = angle;
    }
  }
});

test('gravity and dimensions control elapsed time while performance speed stays external', () => {
  const p = { layout: 'serpentine', count: 32, sizeVariation: 0, growth: 0 };
  const small = compileRun(buildRun({ ...p, size: .8 }));
  const large = compileRun(buildRun({ ...p, size: 1.2 }));
  close(large.duration / small.duration, Math.sqrt(1.2 / .8), 1e-6);
  assert.deepEqual(compileRun(buildRun({ ...p, speed: .35 })), compileRun(buildRun({ ...p, speed: 2.4 })));
  const intervals = small.falls.slice(1).map((f, i) => f.start - small.falls[i].start);
  assert.ok(Math.max(...intervals) - Math.min(...intervals) > .01, 'not a uniform trigger clock');
});

test('forks and a large tapestry branch through actual face overlaps', () => {
  for (const layout of ['fork', 'tapestry']) {
    const run = buildRun({ layout, count: 256 }), score = compileRun(run);
    const children = new Map();
    for (const { from, to } of run.links) children.set(from, [...(children.get(from) || []), to]);
    const splits = [...children].filter(([, ids]) => ids.length === 2);
    assert.ok(splits.length >= (layout === 'tapestry' ? 8 : 3));
    for (const [id, targets] of splits) for (const target of targets) {
      assert.equal(contactGeometry(run.dominoes[id], run.dominoes[target]).reachable, true);
      assert.ok(score.events.some(e => e.id === id && e.targetId === target));
    }
    assertCausal(run, score);
  }
});

test('stairs have bounded terraces and high steps can stop a run that works flat', () => {
  const p = { layout: 'stairs-up', size: .65, spacing: 1.05, stairRise: .3, sizeVariation: 0 };
  const flat = compileRun(buildRun({ ...p, stairRise: 0 }));
  const up = compileRun(buildRun(p));
  const down = compileRun(buildRun({ ...p, layout: 'stairs-down' }));
  assert.equal(flat.reachableCount, DEFAULT_PARAMS.count);
  assert.ok(up.reachableCount < flat.reachableCount / 2);
  assert.ok(up.blockedLinks.some(link => link.reason === 'insufficient transfer'));
  assert.ok(down.reachableCount > up.reachableCount);
  for (const layout of ['stairs-up', 'stairs-down']) {
    const run = buildRun({ layout, count: 512, stairRise: .3 });
    assert.ok(new Set(run.dominoes.map(d => d.elevation)).size > 5);
    assert.ok(Math.max(...run.dominoes.map(d => d.elevation)) <= 3.3 + 1e-9);
    for (let i = 1; i < run.dominoes.length; i++) {
      const change = run.dominoes[i].elevation - run.dominoes[i - 1].elevation;
      assert.ok(layout === 'stairs-up' ? change >= 0 : change <= 0);
    }
  }
});

test('size and material mass mismatches can stall despite geometric reach', () => {
  const a = block(0, 0), larger = block(1, .72, { height: 1.8, width: .9, depth: .288 });
  assert.equal(contactGeometry(a, larger).reachable, true);
  assert.equal(compileRun(pair(a, larger)).reachableCount, 1);
  const reverse = pair({ ...larger, id: 0, x: 0 }, { ...a, id: 1, x: .72 });
  assert.equal(compileRun(reverse).reachableCount, 2);
  const metal = block(1, .6, { material: 'metal' });
  assert.equal(compileRun(pair(a, metal)).reachableCount, 1);
  assert.equal(compileRun(pair({ ...a, material: 'metal' }, block(1, .6))).reachableCount, 2);
});

test('wide spacing exposes a failed link instead of silently advancing the clock', () => {
  const run = buildRun({ layout: 'serpentine', spacing: 1.35 });
  const score = compileRun(run);
  assert.equal(score.reachableCount, 1);
  assert.equal(score.events.length, 1);
  assert.equal(score.events[0].type, 'floor');
  assert.equal(score.stalledIds.length, run.dominoes.length - 1);
  assert.equal(score.blockedLinks[0].reason, 'out of reach');
});

test('manual starts respect identity and discard impacts into an already falling target', () => {
  const run = buildRun({ layout: 'serpentine', count: 24 });
  const manual = compileRun(run, { startIds: [12, 12, 9999] });
  assert.equal(manual.falls[0].id, 12);
  assert.equal(manual.falls.length, 12);
  assert.ok(manual.falls.every(f => f.id >= 12));
  const together = compileRun(run, { startIds: [0, 1] });
  assert.equal(together.falls.filter(f => f.start === 0).length, 2);
  assert.ok(!together.events.some(e => e.type === 'contact' && e.targetId === 1));
  assert.equal(compileRun(run, { force: 0 }).events.length, 0);
  assert.equal(compileRun(run, { startIds: [] }).duration, 0);
});

test('cyclic or duplicate route data cannot replay a falling tile or overflow events', () => {
  const run = buildRun({ count: 16 });
  run.links.push({ from: 15, to: 0 }, ...run.links, { from: 9999, to: 0 });
  const score = compileRun(run);
  assert.equal(score.reachableCount, 16);
  assert.equal(score.falls.length, 16);
  assert.ok(score.events.length <= run.dominoes.length * 3);
});

test('bounded randomization covers full musical state and produces useful repeatable runs', () => {
  const observed = new Map(fullKeys.map(key => [key, new Set()]));
  let playable = 0, partial = 0;
  for (let seed = 0; seed < 128; seed++) {
    const params = randomizeParams(seed);
    assert.deepEqual(Object.keys(params).sort(), fullKeys);
    assert.deepEqual(params, sanitizeParams(params));
    const run = buildRun(params), score = compileRun(run);
    assertCausal(run, score);
    if (score.reachableCount >= params.count * .8) playable++; else partial++;
    assert.ok(!PRESETS.some(p => JSON.stringify(p.params) === JSON.stringify(params)));
    for (const key of fullKeys) observed.get(key).add(params[key]);
  }
  assert.ok(playable >= 128 * 2 / 3, 'most random scenes propagate substantially');
  assert.ok(partial > 0, 'wild random scenes retain real gaps and failed transfers');
  for (const [key, values] of observed) assert.ok(values.size > 1, `frozen randomizer parameter ${key}`);
  assert.equal(observed.get('layout').size, LAYOUTS.length);
  assert.equal(observed.get('material').size, MATERIALS.length + 1);
  assert.deepEqual(randomizeParams(29), randomizeParams(29));
  assert.notDeepEqual(randomizeParams(29), randomizeParams(30));
});


test('lifted nodes preserve later IDs and an empty run has a finite silent score', () => {
  const run = buildRun({ layout: 'serpentine', count: 128 });
  run.dominoes = run.dominoes.filter(d => d.id >= 100);
  const score = compileRun(run, { startIds: [100] });
  assert.equal(score.reachableCount, 28);
  assert.deepEqual(score.falls.map(f => f.id), Array.from({length:28}, (_,i) => i + 100));
  run.dominoes = [];
  const empty = compileRun(run);
  assert.equal(empty.duration, 0);
  assert.deepEqual(empty.events, []);
  assert.deepEqual(empty.falls, []);
  assert.deepEqual(empty.stalledIds, []);
});

const sharingBlock = (id, x, height = 1, z = 0) => block(id, x, {
  height, width: height * .5, depth: height * .16, z, material: 'stone',
});
const fallOf = (score, id) => score.falls.find(f => f.id === id);

test('an unreachable branch cannot steal energy from a real contact', () => {
  const source = sharingBlock(0, 0), target = sharingBlock(1, .3, 1.1);
  const unreachable = sharingBlock(2, 100);
  const single = compileRun(pair(source, target), { force: .4 });
  const fork = compileRun({ dominoes: [source, target, unreachable],
    links: [{ from: 0, to: 1 }, { from: 0, to: 2 }], roots: [0] }, { force: .4 });
  assert.equal(single.reachableCount, 2);
  assert.equal(fork.reachableCount, 2);
  assert.deepEqual(fallOf(fork, 1), fallOf(single, 1));
  assert.ok(fork.blockedLinks.some(link => link.to === 2 && link.reason === 'out of reach'));
});

test('simultaneous standing contacts share energy, but an already falling target takes none', () => {
  const source = sharingBlock(0, 0), left = sharingBlock(1, .3, 1.1, .28);
  const right = sharingBlock(2, .3, 1.1, -.28);
  const run = { dominoes: [source, left, right], links: [{ from: 0, to: 1 }, { from: 0, to: 2 }], roots: [0] };
  const single = compileRun(pair(source, left), { force: .4 });
  const standing = compileRun(run, { force: .4 });
  assert.equal(standing.reachableCount, 1, 'the small impulse cannot tip both standing targets');
  assert.equal(standing.blockedLinks.filter(link => link.reason === 'insufficient transfer').length, 2);
  const started = compileRun(run, { force: .4, startIds: [0, 2] });
  assert.equal(started.reachableCount, 3);
  assert.deepEqual(fallOf(started, 1), fallOf(single, 1));
  assert.ok(!started.events.some(e => e.type === 'contact' && e.targetId === 2));
});

test('a later contact cannot reduce the earlier contact impulse', () => {
  const source = sharingBlock(0, 0), first = sharingBlock(1, .3, 1.1, .28);
  const later = sharingBlock(2, .8, 1.1, -.28);
  const single = compileRun(pair(source, first), { force: .4 });
  const run = { dominoes: [source, first, later], links: [{ from: 0, to: 1 }, { from: 0, to: 2 }], roots: [0] };
  const staggered = compileRun(run, { force: .4 });
  assert.deepEqual(fallOf(staggered, 1), fallOf(single, 1));
  const contacts = staggered.events.filter(e => e.type === 'contact');
  assert.equal(contacts.length, 2);
  assert.ok(contacts[1].time > contacts[0].time + .1);
  assert.deepEqual(compileRun({ ...run, links: [...run.links].reverse() }, { force: .4 }), staggered);
});

test('contact eligibility is evaluated when impact occurs, including another route starting the target first', () => {
  const source = sharingBlock(0, 0), target = sharingBlock(1, .3, 1.1, .28);
  const sharedTarget = sharingBlock(2, .3, 1.1, -.48);
  const otherSource = sharingBlock(3, .117, 1, -.51);
  const single = compileRun(pair(source, target), { force: .4 });
  const run = { dominoes: [source, target, sharedTarget, otherSource],
    links: [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 3, to: 2 }], roots: [0, 3] };
  const score = compileRun(run, { force: .4 });
  assert.equal(score.reachableCount, 4);
  assert.ok(fallOf(score, 2).start < fallOf(score, 1).start);
  assert.deepEqual(fallOf(score, 1), fallOf(compileRun(pair(source, target), { force: .4 }), 1));
  assert.deepEqual(fallOf(score, 1), fallOf(single, 1));
  assert.ok(!score.events.some(e => e.type === 'contact' && e.id === 0 && e.targetId === 2));
});


test('scene parameters retain sound settings and omit live repeat controls, including legacy values', () => {
  const expected = sceneParams(DEFAULT_PARAMS);
  for (const loop of [false, true]) for (const autoStand of [false, true]) {
    assert.deepEqual(sceneParams({...DEFAULT_PARAMS, loop, autoStand, standDelay: 9}), expected);
  }
  for (const key of ['loop','autoStand','standDelay']) assert.equal(key in expected, false);
  assert.equal(expected.soundVariation, .2);
  assert.equal(sceneParams({...DEFAULT_PARAMS,soundVariation:0}).soundVariation, 0);
  assert.equal(sceneParams({...DEFAULT_PARAMS,soundVariation:3}).soundVariation, 1);
  assert.deepEqual(sceneParams(expected), expected);
  assert.equal(new Set(PRESETS.map(p => JSON.stringify(sceneParams(p.params)))).size, PRESETS.length);
});
