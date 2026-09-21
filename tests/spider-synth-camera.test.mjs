import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/three.module.min.js';
import { SpiderSynthViewer, createSpiderFaceBounds } from '../src/instruments/spider-synth/spider-synth-viewer.js';
import { getSpiderDisplayProfile } from '../src/instruments/spider-synth/spider-synth-display.js';

const ids = ['argiope', 'golden', 'devil', 'tarantula', 'huntsman', 'fishing'];
const rigs = await Promise.all(ids.map(id => readFile(new URL(`../assets/spider-synth/${id === 'argiope' ? '' : `skins/${id}/`}rig-manifest.json`, import.meta.url), 'utf8').then(JSON.parse)));
function fixture(rig, width = 390, height = 388) {
  const rect = { width, height }, canvas = { width: 0, height: 0, getBoundingClientRect: () => rect };
  let pixelRatio = 1;
  const renderer = { setPixelRatio: ratio => { pixelRatio = ratio; }, getPixelRatio: () => pixelRatio,
    setSize: (w, h) => { canvas.width = Math.floor(w * pixelRatio); canvas.height = Math.floor(h * pixelRatio); } };
  return Object.assign(Object.create(SpiderSynthViewer.prototype), {
    rect, canvas, renderer, win: { devicePixelRatio: 3 }, displayProfile: getSpiderDisplayProfile({ innerWidth: width }),
    camera: new THREE.PerspectiveCamera(39, width / height, .005, 30), orbit: new THREE.Quaternion(), target: new THREE.Vector3(),
    distance: 2.8, fitDistance: 2.8, zoomFactor: 1, view: 'top', side: 'right', loaded: true, resizeKey: '',
    bones: rig.joints.map(joint => { const bone = new THREE.Bone(); bone.position.fromArray(joint.pivot); bone.position.y += rig.neutralBodyHeight; bone.updateMatrixWorld(); return { bone }; }),
    faceBounds: createSpiderFaceBounds(rig), faceBox: new THREE.Box3(),
    frameData: { body: { x: 0, y: rig.neutralBodyHeight, z: 0 } }, temp: Array.from({ length: 12 }, () => new THREE.Vector3()),
    fill: { position: new THREE.Vector3(), target: { position: new THREE.Vector3() } }, shadow: {},
    invalidate() {}, onChange() {}, getState() {},
  });
}
function assertFrontVisible(viewer, label) {
  for (const entry of viewer.faceBounds) for (const corner of entry.corners) {
    const p = corner.clone().applyMatrix4(viewer.bones[entry.index].bone.matrixWorld).project(viewer.camera);
    assert.ok(Math.abs(p.x) < .98 && Math.abs(p.y) < .98 && p.z > -1 && p.z < 1, `${label}: ${p.toArray()}`);
  }
}

test('phone/coarse/save-data profiles cap graphics independently and remain stable when the viewport rotates', () => {
  const win = { innerWidth: 390, matchMedia: () => ({ matches: false }), navigator: {} };
  const profile = getSpiderDisplayProfile(win); win.innerWidth = 844;
  assert.deepEqual(profile, { mobileAssets: true, maxPixels: 600_000, maxDpr: 1.25, maxFps: 15, shadowMapSize: 512 });
  assert.ok(Object.isFrozen(profile));
  assert.equal(getSpiderDisplayProfile({ innerWidth: 1440, matchMedia: () => ({ matches: true }) }).mobileAssets, true);
  assert.equal(getSpiderDisplayProfile({ innerWidth: 1440, navigator: { connection: { saveData: true } } }).mobileAssets, true);
  assert.deepEqual(getSpiderDisplayProfile({ innerWidth: 1440 }), { mobileAssets: false, maxPixels: 1_150_000, maxDpr: 1.5, maxFps: 20, shadowMapSize: 768 });
});

test('measured front bodies of all six specimens fit portrait, landscape and desktop, including rotated fits', () => {
  for (const rig of rigs) for (const [width, height] of [[390, 388], [390, 600], [844, 240], [1000, 700]]) {
    const viewer = fixture(rig, width, height); viewer.setViewPreset('face'); assertFrontVisible(viewer, rig.id);
    const distance = viewer.distance;
    viewer.orbit.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2)); viewer.updateCamera();
    assert.equal(viewer.distance, distance, 'Orbit does not operate zoom');
    viewer.fit(); assertFrontVisible(viewer, `${rig.id} rotated`);
  }
});

test('long actual tarantula face geometry controls framing rather than a fixed size or just joint pivots', () => {
  const rig = rigs[3], viewer = fixture(rig), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.16, -.03, .35, -.07, .06, .13, .17, -.04, .38, .05, .09, .14], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([2, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0], 4));
  viewer.faceBounds = createSpiderFaceBounds(rig, geometry); viewer.setViewPreset('face');
  assertFrontVisible(viewer, 'tarantula extended palps');
  assert.ok(viewer.distance > .48, 'The old fixed .36-unit camera intersects large anterior parts');
  const fitted = viewer.distance; viewer.zoomBy(.8); assert.equal(viewer.zoomFactor, .8);
  viewer.rect.width = 250; viewer.rect.height = 580; viewer.resize();
  assert.equal(viewer.zoomFactor, .8); assert.ok(viewer.distance > fitted);
  viewer.fit(); assert.equal(viewer.zoomFactor, 1); assertFrontVisible(viewer, 'portrait after Fit');
  viewer.faceBounds = createSpiderFaceBounds(rigs[0]);
  viewer.bones = fixture(rigs[0]).bones; viewer.fit(); assertFrontVisible(viewer, 'replacement specimen');
  geometry.dispose();
});

test('raster resolution obeys the phone budget across orientation and oversized displays', () => {
  const viewer = fixture(rigs[0]);
  for (const [width, height] of [[390, 388], [844, 240], [1600, 1000]]) {
    Object.assign(viewer.rect, { width, height }); viewer.resize();
    assert.ok(viewer.canvas.width * viewer.canvas.height <= 600_000);
    assert.ok(viewer.renderer.getPixelRatio() <= 1.25);
    assert.equal(viewer.displayProfile.mobileAssets, true);
  }
});
