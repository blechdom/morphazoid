import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.min.js';
import { SpiderSynthViewer, sampleSpiderStrand } from '../src/spider-synth-viewer.js';

const segment = { id: 0, a: 0, b: 1, kind: 'radial' };
const a = { x: -.4, y: -.2, z: .1 }, b = { x: .5, y: .3, z: -.15 };
const events = [{ segmentId: 0, u: .3, velocity: 1, audioTime: 10 }];
function fixture() {
  return Object.assign(Object.create(SpiderSynthViewer.prototype), {
    scene: new THREE.Scene(), webRoot: new THREE.Group(), webLines: [], recentEvents: [], audioTime: 10,
    frameData: { body: { x: 0, y: .06, z: 0 }, feet: [] }, bones: [], temp: Array.from({ length: 12 }, () => new THREE.Vector3()),
    preyPool: new Map(), invalidate() {},
  });
}

test('transverse packets originate at the real pluck location, travel and completely decay', () => {
  const line = { ...b, x: .6, y: a.y, z: a.z };
  const near = sampleSpiderStrand(segment, a, line, .31, 10.04, events);
  const far = sampleSpiderStrand(segment, a, line, .8, 10.04, events);
  assert.ok(near.energy > .4); assert.equal(far.energy, 0);
  assert.ok(sampleSpiderStrand(segment, a, line, .8, 10.44, events).energy > .1);
  assert.equal(sampleSpiderStrand(segment, a, line, .31, 9.99, events).energy, 0);
  assert.equal(sampleSpiderStrand(segment, a, line, .31, 12.41, events).energy, 0);
});

test('ordinary audio telemetry with an invalid silk sentinel still excites its actual web segment', () => {
  const viewer = fixture(); viewer.setWeb({ nodes: [a, b], segments: [segment] });
  viewer.setEvents([{ source: 'contact', silkId: -1, segmentId: 0, u: .4, velocity: 1, audioTime: 10 }], 10);
  viewer.setClock(10.1); viewer.updateWeb();
  assert.ok(viewer.sampleStrand(segment, .42).energy > .1);
  assert.ok(viewer.waveStats.maxDisplacement > .001);
  assert.equal(viewer.strandEvents.has('silk:-1'), false);
});

test('screen steering projects right and up in every view without changing camera or input strength', () => {
  const viewer = fixture(); viewer.camera = new THREE.PerspectiveCamera(39, 1.2, .01, 30);
  for (const [position, up] of [
    [[0, 2, .12], [0, 0, 1]], [[0, -2, .08], [0, 0, 1]],
    [[2, .46, .24], [0, 1, 0]], [[0, .28, 2], [0, 1, 0]], [[1.2, 1.4, -.7], [0, 1, 0]],
  ]) {
    viewer.camera.position.fromArray(position); viewer.camera.up.fromArray(up); viewer.camera.lookAt(0, 0, 0); viewer.camera.updateMatrixWorld(true);
    const before = viewer.camera.matrixWorld.elements.slice();
    const right = viewer.screenToWebDirection(1, 0), forward = viewer.screenToWebDirection(0, 1);
    const projectedRight = new THREE.Vector3(right.x * .1, 0, right.z * .1).project(viewer.camera);
    const projectedUp = new THREE.Vector3(forward.x * .1, 0, forward.z * .1).project(viewer.camera);
    assert.ok(projectedRight.x > .001, `Right must move screen-right: ${position}`);
    assert.ok(projectedUp.y > .001, `Forward must move screen-up: ${position}`);
    const small = viewer.screenToWebDirection(.3, .4), full = viewer.screenToWebDirection(1, 1);
    assert.ok(Math.abs(Math.hypot(small.x, small.z) - .5) < 1e-12);
    assert.ok(Math.abs(Math.hypot(full.x, full.z) - 1) < 1e-12);
    assert.deepEqual(viewer.camera.matrixWorld.elements, before);
  }
});

test('every planted toe is exactly pinned in three dimensions while neighboring substrings visibly vibrate', () => {
  const pins = [.18, .4, .77]; let maximum = 0;
  for (let frame = 0; frame < 35; frame++) {
    const time = 10 + frame / 50;
    for (const u of [0, ...pins, 1]) {
      const point = sampleSpiderStrand(segment, a, b, u, time, events, pins);
      assert.equal(point.displacement, 0);
      assert.equal(point.x, a.x + (b.x - a.x) * u);
      assert.equal(point.y, a.y + (b.y - a.y) * u);
      assert.equal(point.z, a.z + (b.z - a.z) * u);
    }
    for (let i = 0; i <= 100; i++) {
      const point = sampleSpiderStrand(segment, a, b, i / 100, time, events, pins);
      assert.ok(Object.values(point).every(Number.isFinite)); assert.ok(point.displacement <= .065);
      maximum = Math.max(maximum, point.displacement);
    }
  }
  assert.ok(maximum > .015, `Magnified movement must be legible: ${maximum}`);
});

test('3D graph updates retain buffers during bounded incremental growth and include exact toe knots', () => {
  const viewer = fixture(), web = { nodes: [a, b], segments: [segment] };
  assert.equal(viewer.setWeb(web), true);
  const buffer = viewer.webLines[0].lines.geometry.attributes.position.array;
  web.nodes.push({ x: .7, y: -.3, z: .2 }); web.segments.push({ id: 1, a: 1, b: 2, kind: 'radial' });
  viewer.setWeb(web); assert.equal(viewer.webLines[0].lines.geometry.attributes.position.array, buffer);
  viewer.frameData.feet = [{ stance: true, segmentId: 0, u: .4 }]; viewer.setEvents(events, 10); viewer.setClock(10.12); viewer.updateWeb();
  const points = viewer.getSegmentSamples(0), toe = points.find(point => point.u === .4);
  assert.ok(toe); assert.equal(toe.displacement, 0); assert.ok(points.some(point => point.displacement > .001));
  assert.equal(viewer.webFlat, false);
  assert.equal(viewer.setWeb({ nodes: [a], segments: [{ id: 0, a: 0, b: 2 }] }), false);
  assert.equal(viewer.web.segments.length, 2);
});

test('world prey have finite wing motion, stable identity and disappear when eaten or removed', () => {
  const viewer = fixture(); viewer.setWeb({ nodes: [a, b], segments: [segment] });
  const snapshot = { time: 10, prey: [{ id: 'fly-one', state: 'flying', x: .2, y: .2, z: .1, struggle: 1 }], silkSegments: [] };
  viewer.setWorld(snapshot); snapshot.prey[0].x = 99; viewer.updateWorldVisuals();
  const fly = viewer.preyPool.get('fly-one'); assert.equal(fly.position.x, .2);
  const before = [...fly.userData.wingMesh.instanceMatrix.array];
  viewer.setWorld({ ...snapshot, time: 10.08, prey: [{ id: 'fly-one', state: 'trapped', x: .2, y: 0, z: .1, struggle: 1 }] }); viewer.updateWorldVisuals();
  assert.equal(viewer.preyPool.get('fly-one'), fly); assert.notDeepEqual([...fly.userData.wingMesh.instanceMatrix.array], before);
  assert.ok([...fly.userData.wingMesh.instanceMatrix.array].every(Number.isFinite));
  viewer.setWorld({ time: 12, prey: [{ id: 'fly-one', state: 'eaten', x: .2, y: 0, z: .1 }], silkSegments: [] }); viewer.updateWorldVisuals();
  assert.equal(viewer.preyPool.size, 0); assert.equal(fly.parent, null);
});

test('deposited silk uses its own event identity and the current spinning thread reaches the abdomen', () => {
  const viewer = fixture(); viewer.setWeb({ nodes: [a, b], segments: [segment] });
  const bone = new THREE.Bone(); bone.position.set(.1, .2, .3); bone.updateMatrixWorld(true); viewer.bones = [{ id: 'abdomen', bone }];
  const silk = { id: 'silk-9', ax: -.2, ay: .1, az: .5, bx: .4, by: .2, bz: .3, born: 10 };
  viewer.setWorld({ time: 10.1, prey: [], silkSegments: [silk], activeSilk: { ...silk, progress: .5 } });
  viewer.setEvents([{ source: 'silk', silkId: 'silk-9', u: .4, audioTime: 10, velocity: 1 }], 10); viewer.setClock(10.1); viewer.updateWeb();
  assert.ok(viewer.sampleSilk(silk, .45).displacement > .001);
  assert.equal(viewer.sampleStrand(segment, .45).displacement, 0);
  const geometry = viewer.silkLines.geometry, endpoint = geometry.drawRange.count - 1;
  assert.ok(Math.abs(geometry.attributes.position.getX(endpoint) - .1) < 1e-7);
  assert.ok(Math.abs(geometry.attributes.position.getY(endpoint) - .2) < 1e-7);
  assert.ok(Math.abs(geometry.attributes.position.getZ(endpoint) - .21) < 1e-7);
  viewer.setWorld({ time: 11, prey: [], silkSegments: [], activeSilk: null }); viewer.updateWorldVisuals();
  assert.equal(viewer.silkLines.geometry.drawRange.count, 0);
});
