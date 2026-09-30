import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDrawnRun, samplePolyline, sanitizeDrawing, MAX_DRAWN_DOMINOES,
  MAX_DRAWING_POINTS, MAX_DRAWING_STROKES } from '../src/instruments/domino-run/domino-run-drawing.js';
import { compileRun, createRunSimulation } from '../src/instruments/domino-run/domino-run-model.js';

const params = { size: 1, spacing: .5, sizeVariation: 0, growth: 0, material: 'stone', seed: 17 };
const drawing = (...strokes) => ({ version: 1, strokes: strokes.map((points, id) => ({ id, points, closed: false })) });
const approx = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} differs from ${b}`);

test('freehand sampling follows arc distance through corners rather than cutting a chord', () => {
  const result = samplePolyline([{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }], { spacing: 1 });
  assert.deepEqual(result, [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 },
    { x: 3, z: 1 }, { x: 3, z: 2 }, { x: 3, z: 3 }]);
  const residual = samplePolyline([{ x: 1, z: 2 }, { x: 3.5, z: 2 }], { spacing: 1 });
  for (let i = 1; i < residual.length; i += 1) approx(residual[i].x - residual[i - 1].x, 2.5 / 3);
});

test('new straight paths propagate, point forward, and keep authored world coordinates', () => {
  const run = buildDrawnRun(drawing([{ x: 10, z: -4 }, { x: 16, z: -4 }]), params);
  assert.equal(run.dominoes.length, 11);
  assert.deepEqual(run.roots, [0]);
  assert.equal(run.dominoes[0].x, 10);
  assert.equal(run.dominoes.at(-1).x, 16);
  assert.ok(run.dominoes.every(d => d.z === -4 && d.angle === 0));
  assert.equal(compileRun(run).reachableCount, run.dominoes.length);
});

test('separate and crossing strokes get independent roots without teleporting across the gap', () => {
  const run = buildDrawnRun(drawing([{ x: 0, z: 0 }, { x: 3, z: 0 }],
    [{ x: 60, z: 60 }, { x: 60, z: 63 }]), params);
  assert.equal(run.roots.length, 2);
  const boundary = run.roots[1];
  assert.ok(run.links.every(link => (link.from < boundary) === (link.to < boundary)));
  const firstOnly = compileRun(run, { startIds: [0] });
  assert.equal(firstOnly.reachableCount, boundary);
  assert.ok(firstOnly.stalledIds.includes(boundary));
  const crossed = buildDrawnRun(drawing([{ x: -2, z: 0 }, { x: 2, z: 0 }],
    [{ x: 0, z: -2 }, { x: 0, z: 2 }]), params);
  assert.equal(crossed.links.length, crossed.dominoes.length - 2);
});

test('near-ended loop closes once without duplicating its first tile; far-ended path never adds a chord', () => {
  const points = Array.from({ length: 81 }, (_, i) => ({ x: 4 * Math.cos(i * Math.PI * 2 / 80), z: 4 * Math.sin(i * Math.PI * 2 / 80) }));
  const data = { version: 1, strokes: [{ id: 4, points, closed: true }] };
  const run = buildDrawnRun(data, params);
  assert.equal(run.strokeRanges[0].closed, true);
  assert.deepEqual(run.links.at(-1), { from: run.dominoes.length - 1, to: 0 });
  assert.notDeepEqual({ x: run.dominoes.at(-1).x, z: run.dominoes.at(-1).z }, points[0]);
  assert.equal(compileRun(run).reachableCount, run.dominoes.length);
  const far = buildDrawnRun({ version: 1, strokes: [{ id: 0, closed: true,
    points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }] }] }, params);
  assert.equal(far.strokeRanges[0].closed, false);
  assert.equal(far.links.length, far.dominoes.length - 1);
});

test('sound and material changes retain positions, while size changes resample the same authored path', () => {
  const raw = drawing([{ x: -4, z: 8 }, { x: 8, z: 8 }]);
  const a = buildDrawnRun(raw, params);
  const b = buildDrawnRun(raw, { ...params, ring: .96, brightness: .18, speed: 2, loop: false, material: 'metal' });
  assert.deepEqual(b.dominoes.map(({ x, z, angle, height }) => ({ x, z, angle, height })),
    a.dominoes.map(({ x, z, angle, height }) => ({ x, z, angle, height })));
  assert.ok(b.dominoes.every(d => d.material === 'metal'));
  const large = buildDrawnRun(raw, { ...params, size: 1.5 });
  assert.deepEqual(large.drawing, a.drawing);
  assert.ok(large.dominoes.length < a.dominoes.length);
  assert.equal(large.dominoes[0].x, -4);
  approx(large.dominoes.at(-1).x, 8);
});

test('seeded variation is deterministic, does not mutate authored input and survives persistence', () => {
  const raw = drawing([{ x: 0, z: 0 }, { x: 9, z: 0 }]);
  const before = JSON.stringify(raw);
  const settings = { ...params, sizeVariation: .25, material: 'mixed' };
  const a = buildDrawnRun(raw, settings);
  assert.deepEqual(buildDrawnRun(JSON.parse(JSON.stringify(a.drawing)), settings), a);
  assert.equal(JSON.stringify(raw), before);
  assert.notDeepEqual(buildDrawnRun(raw, { ...settings, seed: 222 }).dominoes.map(d => d.height), a.dominoes.map(d => d.height));
});

test('capacity truncates locally at 1024 and never adds a closing jump to an unfinished loop', () => {
  const points = Array.from({ length: 130 }, (_, i) => ({ x: i % 2 ? 150 : -150, z: i - 65 }));
  const run = buildDrawnRun({ version: 1, strokes: [{ id: 0, points: [...points, points[0]], closed: true }] }, params);
  assert.equal(run.dominoes.length, MAX_DRAWN_DOMINOES);
  assert.equal(run.truncated, true);
  assert.equal(run.strokeRanges[0].closed, false);
  assert.equal(run.links.length, run.dominoes.length - 1);
  for (const link of run.links) {
    const a = run.dominoes[link.from], b = run.dominoes[link.to];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) <= .6 + 1e-6);
  }
});

test('persisted garbage, coordinate bounds and tiny strokes remain safe and finite', () => {
  assert.deepEqual(sanitizeDrawing(null), { version: 1, strokes: [] });
  assert.deepEqual(sanitizeDrawing({ version: 2, strokes: [] }), { version: 1, strokes: [] });
  const repaired = sanitizeDrawing({ version: 1, strokes: [
    { id: 1, points: [{ x: -99999, z: 99999 }, null, { x: Infinity, z: 0 }, { x: 1, z: 1 }] },
    { id: 1, points: [{ x: 2, z: 2 }, { x: 3, z: 3 }] },
  ] });
  assert.deepEqual(repaired.strokes[0].points[0], { x: -10000, z: 10000 });
  assert.equal(new Set(repaired.strokes.map(s => s.id)).size, 2);
  const huge = sanitizeDrawing(drawing(...Array.from({ length: 100 }, () => Array.from({ length: 3000 }, (_, i) => ({ x: i % 100, z: i % 101 })))));
  assert.ok(huge.strokes.length <= MAX_DRAWING_STROKES);
  assert.ok(huge.strokes.reduce((sum, s) => sum + s.points.length, 0) <= MAX_DRAWING_POINTS);
  const empty = buildDrawnRun(drawing([{ x: 0, z: 0 }, { x: .001, z: 0 }]), params);
  assert.deepEqual(empty.dominoes, []);
  assert.deepEqual(empty.roots, []);
  assert.ok(Object.values(empty.bounds).every(Number.isFinite));
});


test('duplicate and extreme persisted stroke IDs normalize to bounded stable IDs', () => {
  const points = [{ x: 0, z: 0 }, { x: 2, z: 0 }];
  const ids = [63, 63, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
    Infinity, NaN, -1, .5, ...Array.from({ length: 56 }, () => 63)];
  const repaired = sanitizeDrawing({ version: 1,
    strokes: ids.map(id => ({ id, points, closed: false })) });
  assert.equal(repaired.strokes.length, MAX_DRAWING_STROKES);
  assert.equal(new Set(repaired.strokes.map(stroke => stroke.id)).size, MAX_DRAWING_STROKES);
  assert.ok(repaired.strokes.every(stroke => Number.isInteger(stroke.id)
    && stroke.id >= 0 && stroke.id < MAX_DRAWING_STROKES));
  assert.deepEqual(sanitizeDrawing(repaired), repaired);
});


test('a hand-drawn closed loop can sustain new falls after individual recovery', () => {
  const points=Array.from({length:97},(_,i)=>({x:4*Math.cos(i/96*Math.PI*2),z:4*Math.sin(i/96*Math.PI*2)}));
  const shape={version:1,strokes:[{id:0,closed:true,points}]};
  const run=buildDrawnRun(shape,{...params,autoStand:true,standDelay:.3,speed:1.6});
  const simulation=createRunSimulation(run);
  simulation.advance(30);
  assert.equal(simulation.reachableCount,run.dominoes.length);
  assert.ok(simulation.falls.filter(f=>f.id===run.roots[0]).length>=4);
  assert.equal(simulation.hasPending,true);
  const openRun=buildDrawnRun({...shape,strokes:[{...shape.strokes[0],closed:false}]},run.params);
  const openSimulation=createRunSimulation(openRun);openSimulation.advance(30);
  assert.equal(openSimulation.hasPending,false);
  assert.equal(openSimulation.falls.filter(f=>f.id===0).length,1);
});


test('drawn paths reverse from their ends and transform without changing authored coordinates', () => {
  const raw = drawing([{ x: 2, z: 4 }, { x: 8, z: 4 }], [{ x: -3, z: -2 }, { x: -3, z: 4 }]);
  const before = JSON.stringify(raw), forward = buildDrawnRun(raw, params);
  const reverse = buildDrawnRun(raw, { ...params, direction: 'reverse', rotation: 90, stretch: 2 });
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(reverse.drawing, forward.drawing);
  assert.deepEqual(reverse.roots, forward.strokeRanges.map(stroke => stroke.lastId));
  assert.deepEqual(reverse.links, forward.links.map(({ from, to }) => ({ from: to, to: from })));
  for (let i = 0; i < forward.dominoes.length; i++) {
    approx(reverse.dominoes[i].x, -forward.dominoes[i].z);
    approx(reverse.dominoes[i].z, forward.dominoes[i].x * 2);
  }
  const plainReverse = buildDrawnRun(raw, { ...params, direction: 'reverse' });
  assert.equal(compileRun(plainReverse).reachableCount, plainReverse.dominoes.length);
});

test('drawn height and gradient controls reach beyond the previous size limits', () => {
  const raw = drawing([{ x: 0, z: 0 }, { x: 120, z: 0 }]);
  const tiny = buildDrawnRun(raw, { ...params, size: .1 });
  const giant = buildDrawnRun(raw, { ...params, size: 6, growth: 2 });
  assert.ok(tiny.dominoes.every(tile => tile.height < .2));
  assert.ok(giant.dominoes.at(-1).height > 50);
  assert.ok(giant.dominoes.at(-1).height / giant.dominoes[0].height > 50);
  for (const run of [tiny, giant]) {
    assert.ok(run.dominoes.length <= MAX_DRAWN_DOMINOES);
    assert.ok(run.dominoes.every(tile => tile.height >= .03 && tile.height <= 64));
    assert.ok(Object.values(run.bounds).every(Number.isFinite));
    assert.ok(compileRun(run).events.every(event => Number.isFinite(event.time)));
  }
});
