import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSpiderScreenStrand } from '../src/instruments/spider-synth/spider-synth-strum.js';
import { SpiderSynthViewer } from '../src/instruments/spider-synth/spider-synth-viewer.js';
const rect = { left: 10, top: 20, width: 100, height: 100 };
const point = (x, y, depthVisible = true) => ({ x, y, depthVisible, visible: false });
test('clipping retains a viewport-spanning strand with neither endpoint onscreen', () => {
  const clipped = clipSpiderScreenStrand(point(-20, 70), point(130, 70), rect);
  assert.deepEqual(clipped.a, { x: 10, y: 70 }); assert.deepEqual(clipped.b, { x: 110, y: 70 });
  assert.equal(clipped.t0, .2); assert.ok(Math.abs(clipped.t1 - 13 / 15) < 1e-12);
});
test('wholly offscreen, depth-rejected and invalid parts stay excluded', () => {
  for (const [a, b] of [[point(-20, 0), point(130, 0)], [point(0, 10), point(120, 10)],
    [point(-20, 70, false), point(130, 70, false)], [point(-20, 70, false), point(130, 70)],
    [point(NaN, 70), point(130, 70)]]) assert.equal(clipSpiderScreenStrand(a, b, rect), null);
});
function viewerFixture(depthVisible = true) {
  return Object.assign(Object.create(SpiderSynthViewer.prototype), {
    canvas: { getBoundingClientRect: () => rect }, web: { segments: [{ id: 2 }] },
    world: { silkSegments: [{ id: 'thread-7' }] }, strandEvents: new Map(),
    getSegmentScreenPosition: (id, u) => point(-20 + 150 * u, 50, depthVisible),
    getSilkScreenPosition: (id, u) => point(-20 + 150 * u, 90, depthVisible),
  });
}
test('both strand pickers and a sweep retain correct original u after clipping', () => {
  const viewer = viewerFixture();
  assert.ok(Math.abs(viewer.pickWeb(60, 50).u - 8 / 15) < 1e-12);
  assert.ok(Math.abs(viewer.pickSilk(60, 90).u - 8 / 15) < 1e-12);
  const hits = viewer.sweepStrands({ x: 60, y: 25 }, { x: 60, y: 115 }, new Set());
  assert.deepEqual(hits.map(hit => hit.key), ['web:2', 'silk:thread-7']);
  assert.ok(hits.every(hit => Math.abs(hit.u - 8 / 15) < 1e-12));
  assert.equal(viewer.sweepStrands({ x: -20, y: 25 }, { x: -20, y: 115 }, new Set()).length, 0);
});
test('depth-rejected strands cannot start or participate in strums', () => {
  const viewer = viewerFixture(false);
  assert.equal(viewer.pickWeb(60, 50), null); assert.equal(viewer.pickSilk(60, 90), null);
  assert.deepEqual(viewer.sweepStrands({ x: 60, y: 25 }, { x: 60, y: 115 }, new Set()), []);
});
