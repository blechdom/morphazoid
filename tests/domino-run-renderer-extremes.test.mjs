import assert from 'node:assert/strict';
import test from 'node:test';
import { DominoRenderer } from '../src/instruments/domino-run/domino-run-renderer.js';
import { MAX_DRAWN_DOMINOES } from '../src/instruments/domino-run/domino-run-drawing.js';

function fixture(width = 1130, height = 745) {
  const painted = [], strokes = [], samples = [];
  let path = [];
  const context = new Proxy({
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath() { path = []; },
    moveTo(x, y) { path.push({ x, y }); }, lineTo(x, y) { path.push({ x, y }); },
    stroke() { if (this.strokeStyle === '#f2cd88') strokes.push(path); },
    arc(x, y) { if (this.fillStyle === '#ffe0a0') samples.push({ x, y }); },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const view = new DominoRenderer({ getContext: () => context, getBoundingClientRect: () => ({ width, height }) });
  view.polygon = points => painted.push(points);
  return { view, painted, strokes, samples };
}
const domino = (id, overrides = {}) => ({ id, x: 0, z: 0, elevation: 0, height: 1.2, width: .6, depth: .192, angle: 0, material: 'stone', ...overrides });
const idle = { events: [], falls: [] };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);

test('Fit includes large falling tiles, negative elevations, and distant coordinates on all three stage sizes', () => {
  const run = { dominoes: [
    domino(0, { x: -100000, z: -80000, elevation: -900, height: 64, width: 32, depth: 10.24 }),
    domino(1, { x: 100000, z: 70000, elevation: 800, height: 64, width: 32, depth: 10.24, angle: 2.1 }),
    domino(2, { x: 0, z: 0, height: .03, width: .015, depth: .0048 }),
  ] };
  for (const [width, height] of [[1130, 745], [390, 414], [559, 300]]) {
    const { view, painted } = fixture(width, height);
    for (const yaw of [-.48, 2.8]) for (const tilt of [.08, 1.3]) {
      Object.assign(view, { yaw, tilt, zoom: 1 }); view.fit(run);
      assert.ok(Number.isFinite(view.scale) && view.scale > 0);
      for (const angle of [0, .7, Math.PI / 2]) {
        painted.length = 0;
        for (const tile of run.dominoes) view.box(tile, angle);
        for (const point of painted.flat()) {
          assert.ok(point.x >= 0 && point.x <= width, `x ${point.x}/${width}`);
          assert.ok(point.y >= 0 && point.y <= height, `y ${point.y}/${height}`);
        }
      }
    }
  }
});

test('Fit also fills a useful part of the stage for the smallest scene', () => {
  const { view, painted } = fixture(390, 414);
  const tiles = Array.from({ length: 4 }, (_, id) => domino(id, { x: id * .04, height: .03, width: .015, depth: .0048 }));
  view.fit({ dominoes: tiles });
  for (const tile of tiles) view.box(tile, 0);
  const vertices = painted.flat();
  const width = Math.max(...vertices.map(p => p.x)) - Math.min(...vertices.map(p => p.x));
  assert.ok(width > 100, `Fit should recover tiny scenes, width ${width}`);
});

test('size-ratio zoom compensation remains visible and Fit recovers framing', () => {
  const { view } = fixture();
  const original = { dominoes: Array.from({ length: 16 }, (_, id) => domino(id, { x: Math.cos(id * Math.PI / 8) * 5, z: Math.sin(id * Math.PI / 8) * 5 })) };
  view.fit(original);
  const initialPixels = original.dominoes[0].height * view.scale;
  const large = { dominoes: original.dominoes.map(tile => Object.fromEntries(Object.entries(tile).map(([key, value]) => [key, ['x','z','elevation','height','width','depth'].includes(key) ? value * 5 : value]))) };
  view.zoom = 5; view.fit(large);
  near(large.dominoes[0].height * view.scale, initialPixels * 5);
  view.zoom = 1; view.fit(large);
  near(large.dominoes[0].height * view.scale, initialPixels);
});

test('1024 projected hit regions remain finite and select visible faces without triggering empty stage', () => {
  const { view } = fixture();
  Object.assign(view, { scale: 2, ox: 10, oy: 10 });
  for (let id = 0; id < 1024; id++) view.box(domino(id, { x: id % 32 * 3, z: Math.floor(id / 32) * 3 }), .8);
  assert.equal(view.hits.length, 1024);
  assert.ok(view.hits.every(hit => Object.values(hit.bounds).every(Number.isFinite)));
  const last = view.hits.at(-1), points = last.polygons.at(-1);
  const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  assert.equal(view.hit(x, y), 1023);
  assert.equal(view.hit(-1000000, -1000000), null);
});

for (const [rotation, stretch] of [[0, 1], [90, 3], [-135, .2]]) {
  test(`drawing preview follows the authored transform (${rotation} degrees, stretch ${stretch})`, () => {
    const { view, strokes, samples } = fixture();
    const points = [{ x: 1, z: 2 }, { x: 4, z: 2 }];
    const before = JSON.stringify(points);
    view.render({ dominoes: [], links: [], roots: [], params: { size: 1, spacing: .5, rotation, stretch } }, idle, 0, { draft: { points } });
    assert.equal(strokes.length, 1);
    const transform = (point, elevation) => {
      const angle = rotation * Math.PI / 180;
      return view.project(point.x * stretch * Math.cos(angle) - point.z * Math.sin(angle), elevation,
        point.x * stretch * Math.sin(angle) + point.z * Math.cos(angle));
    };
    points.forEach((point, i) => { const expected = transform(point, .03); near(strokes[0][i].x, expected.x); near(strokes[0][i].y, expected.y); });
    const first = transform(points[0], .04), last = transform(points.at(-1), .04);
    near(samples[0].x, first.x); near(samples[0].y, first.y);
    near(samples.at(-1).x, last.x); near(samples.at(-1).y, last.y);
    assert.equal(JSON.stringify(points), before);
  });
}

test('dense drawing preview samples use the shared capacity and stay bounded', () => {
  const { view, samples } = fixture();
  view.render({ dominoes: [], links: [], roots: [], params: { size: .1, spacing: .12, rotation: 180, stretch: 5 } }, idle, 0,
    { draft: { points: [{ x: -150, z: 0 }, { x: 150, z: 0 }] } });
  assert.equal(samples.length, MAX_DRAWN_DOMINOES);
  assert.ok(samples.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});
