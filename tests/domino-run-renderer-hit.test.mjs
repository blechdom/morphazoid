import assert from 'node:assert/strict';
import test from 'node:test';
import { DominoRenderer } from '../src/instruments/domino-run/domino-run-renderer.js';

function renderer() {
  const context = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, {
    get(target, key) { return target[key] ?? (() => {}); },
  });
  const canvas = { getContext: () => context, getBoundingClientRect: () => ({ width: 800, height: 600 }) };
  const result = new DominoRenderer(canvas);
  Object.assign(result, { fitLocked: true, scale: 40, ox: 400, oy: 300 });
  const painted = [];
  result.polygon = points => painted.push(points);
  return { view: result, painted };
}
const tile = overrides => ({ id: 7, x: 0, z: 0, elevation: 0, height: 4, width: .7, depth: .16, angle: 0, color: '#a6aca0', material: 'stone', ...overrides });
const run = dominoes => ({ dominoes, links: [], roots: [] });
const idle = { falls: [], events: [] };
const center = points => ({ x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length });
const legacyDistance = (point, hit) => Math.min(Math.hypot(point.x - hit.x, point.y - hit.y), Math.hypot(point.x - hit.bx, point.y - hit.by));

// Points come from the faces passed to the painter, independently of the hit data.
test('a tall domino can be picked on its top face beyond the old center/base circles', () => {
  const { view, painted } = renderer();
  view.box(tile(), 0);
  const top = painted.map(center).sort((a, b) => a.y - b.y)[0];
  assert.ok(legacyDistance(top, view.hits[0]) > view.hits[0].radius);
  assert.equal(view.hit(top.x, top.y), 7);
});

test('all painted face interiors and corners remain pickable through zoom, orbit, and falling', () => {
  const { view, painted } = renderer();
  for (const scale of [2, 12, 60]) for (const yaw of [-.48, .8, 2.4]) for (const angle of [0, .5, 1.2, Math.PI / 2]) {
    Object.assign(view, { scale, yaw, hits: [] });
    painted.length = 0;
    view.box(tile({ elevation: .7 }), angle);
    for (const points of painted) {
      const middle = center(points);
      for (const vertex of points) for (const towardCorner of [0, .95, 1]) {
        const x = middle.x + (vertex.x - middle.x) * towardCorner;
        const y = middle.y + (vertex.y - middle.y) * towardCorner;
        assert.equal(view.hit(x, y), 7, `scale ${scale}, yaw ${yaw}, fall ${angle}`);
      }
    }
  }
});

test('overlapping dominoes select the last painted visible piece, not a hidden nearer center', () => {
  const { view } = renderer();
  view.yaw = 0;
  const back = tile({ id: 1, height: 2, depth: .2, width: 1 });
  const front = tile({ id: 2, x: .06, z: .1, height: 2, depth: .2, width: 1 });
  view.render(run([front, back]), idle, 0);
  assert.deepEqual(view.hits.map(hit => hit.id), [1, 2]);
  const point = view.hits[0];
  assert.equal(legacyDistance(point, view.hits[0]), 0);
  assert.equal(view.hit(point.x, point.y), 2);
});

test('empty space beside a narrow domino stays empty while its painted outline is clickable', () => {
  const { view, painted } = renderer();
  view.yaw = 0;
  view.box(tile({ height: 1, width: .4, depth: .12 }), 0);
  const right = Math.max(...painted.flat().map(point => point.x));
  const y = view.hits[0].y;
  assert.equal(view.hit(right + .3, y), 7, 'the .7px outline is visible');
  assert.equal(view.hit(right + .6, y), null, 'no invisible halo beyond the outline');
  const empty = { x: right + 6, y };
  assert.ok(legacyDistance(empty, view.hits[0]) < view.hits[0].radius);
  assert.equal(view.hit(empty.x, empty.y), null);
  assert.equal(view.hit(0, 0), null);
});

test('each render refreshes the projected hit geometry after a piece moves', () => {
  const { view } = renderer();
  view.render(run([tile()]), idle, 0);
  const old = { x: view.hits[0].x, y: view.hits[0].y };
  view.render(run([tile({ x: 8 })]), idle, 0);
  assert.equal(view.hits.length, 1);
  assert.equal(view.hit(old.x, old.y), null);
  const current = view.hits[0];
  assert.equal(view.hit(current.x, current.y), 7);
});

test('lifted-out pieces retain their bounded editing-marker targets', () => {
  const { view } = renderer();
  view.render(run([tile({ enabled: false })]), idle, 0);
  const marker = view.hits[0];
  assert.equal(view.hit(marker.x, marker.y), 7);
  assert.equal(view.hit(marker.x + 11, marker.y), 7);
  assert.equal(view.hit(marker.x + 13, marker.y), null);
});
