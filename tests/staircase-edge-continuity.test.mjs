import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildStaircaseField, matchStaircaseBranches, pairStaircaseBlockEdges, readStaircaseRhythm,
} from '../src/instruments/striped-staircase-rust/field.js';
import { buildStaircaseContourPaths } from '../src/instruments/striped-staircase-rust/contour-paths.js';
import { cameraFromView, viewById } from '../src/instruments/striped-staircase/striped-staircase.js';

const line = (x, y, height) => ({ points: [{ x, y }, { x, y: y + height / 2 }, { x, y: y + height }], length: height, closed: false });
const hash = array => createHash('sha256').update(new Uint8Array(array.buffer)).digest('hex');
const aspect = 1070 / 776;
const movement = (a, b) => Math.hypot((a.cx - b.cx) * aspect, a.cy - b.cy);

test('paired continuation follows the nearby anchor fragment instead of the distant centroid fragment', () => {
  const previous = [{ id: 1, slot: 0, parentId: 0, cx: .42, cy: .40, length: 1.1,
    anchor: { x: .332, y: .913 }, points: new Float32Array([.3, .2, .33, .91]) }];
  const paths = [line(.45, .35, .17), line(.38, .85, .12)];
  const centerMatch = matchStaircaseBranches(paths, previous, aspect);
  assert.equal(centerMatch[0].id, 1, 'this is the old centroid counterexample');
  const edgeMatch = matchStaircaseBranches(paths, previous, aspect, { followAnchor: true });
  assert.equal(edgeMatch[1].id, 1);
  assert.equal(edgeMatch[1].slot, 0);
  assert.notEqual(edgeMatch[0].id, 1, 'the remote fragment must not interpolate from the old voice');
  assert.equal(edgeMatch[0].parentId, 0, 'a rejected continuation does not invent ancestry');
});

test('two anchor tracks keep reciprocal identities and slots when path ordering reverses', () => {
  const previous = [
    { id: 11, slot: 3, parentId: 0, cx: .5, cy: .5, length: .2, anchor: { x: .2, y: .2 } },
    { id: 22, slot: 5, parentId: 0, cx: .5, cy: .5, length: .2, anchor: { x: .8, y: .8 } },
  ];
  const next = matchStaircaseBranches([line(.79, .7, .2), line(.21, .1, .2)], previous, 1, { followAnchor: true });
  assert.deepEqual(next.map(branch => [branch.id, branch.slot]), [[22, 5], [11, 3]]);
  const distant = matchStaircaseBranches([line(.5, .45, .1)], previous, 1, { followAnchor: true });
  assert.ok(distant[0].id > 22);
  assert.equal(distant[0].parentId, 0);
});

test('a nearby middle anchor cannot retain an ID when either actual edge jumps away', () => {
  const path = line(.5, .2, .6);
  const prior = { id: 17, slot: 0, parentId: 0, cx: .5, cy: .5, length: .6,
    anchor: { x: .5, y: .5 }, edgeOrder: ['low', 'high'],
    edgePoints: { low: { x: .1, y: .5 }, high: { x: .6, y: .5 } } };
  const current = { ...prior };
  const scalar = { columns: 21, rows: 21,
    depth: Float64Array.from({ length: 21 * 21 }, (_, index) => (index % 21) / 20) };
  const voices = pairStaircaseBlockEdges(scalar, [current], [path], .4, .6, 1, [prior], null, { identity: { nextId: 18 } });
  assert.equal(voices.length, 2);
  assert.deepEqual(voices.map(voice => voice.id), [35, 36]);
  assert.deepEqual(voices.map(voice => voice.boundary), ['low', 'high']);
  assert.ok(voices.every(voice => voice.parentId === 0));
  assert.ok(Math.abs(voices[0].cx - .4) < 1e-9 && Math.abs(voices[1].cx - .6) < 1e-9);
});

test('real Seahorse early depths cannot retain one ID across the former long V-shaped jumps', () => {
  const field = buildStaircaseField({ pitchSource: 1, resolution: 112, aspect });
  const paths = buildStaircaseContourPaths(field);
  let localContinuations = 0, changedIdentities = 0;
  for (let frame = 1; frame < field.frames; frame++) {
    const previous = new Map(field.overlays[frame - 1].branches.map(branch => [branch.id, branch]));
    for (const branch of field.overlays[frame].branches) {
      const old = previous.get(branch.id);
      if (old) {
        assert.ok(movement(old, branch) <= .150001, `frame ${frame} voice ${branch.id} crosses unsupported space`);
        assert.equal(branch.boundary, old.boundary);
        localContinuations++;
      } else if (frame >= 9 && frame <= 12) changedIdentities++;
    }
  }
  assert.ok(localContinuations > 100, 'continuity remains playable instead of assigning every frame a new ID');
  assert.ok(changedIdentities >= 4, 'the formerly unbroken early track now ends where continuity is unsupported');
  for (const path of paths.paths) for (const run of path.runs) for (let i = 2; i < run.points.length; i += 2) {
    assert.ok(Math.hypot((run.points[i] - run.points[i - 2]) * aspect, run.points[i + 1] - run.points[i - 1]) <= .150001);
  }
  assert.ok(readStaircaseRhythm(field, .175).count >= 2, 'the default held-white view keeps measured audible pairs');
});

test('center-mode table and feature bytes retain their pre-continuity-fix baseline', () => {
  // Baselines captured before the paired-only change: ordinary landscape plus
  // a portrait branching view exercise both slot matching and feature lineage.
  for (const [options, table, features] of [
    [{ pitchSource: 0, resolution: 48, voiceLimit: 8, aspect: 1.4 },
      'd72fbb4775cc4f3302d9a057b7120526608773e49836d021208aad420730da6c',
      'b1994e90aa57b04b737864d3052c550f17153379a1bf7957cfcc8de1d3ed6fd5'],
    [{ pitchSource: 0, resolution: 64, voiceLimit: 64, aspect: .6, camera: cameraFromView(viewById('triple-spiral')) },
      '3cd4928c73a44451d65bdcc06aee124e2f5bf8d95fe1f09c9900c664a847066f',
      '0becfa8f0fb338b5bcf4543cf49951ea06c7a9a8ab16fbcaf3053f4d15039779'],
  ]) {
    const field = buildStaircaseField(options);
    assert.equal(hash(field.table), table);
    assert.equal(hash(field.features), features);
  }
});

test('the replacement Spiral passage has a certified fork and unchanged references at a two-voice budget', () => {
  const options = { pitchSource: 1, resolution: 112, aspect, camera: cameraFromView(viewById('spiral')) };
  const field = buildStaircaseField({ ...options, voiceLimit: 32 });
  const limited = buildStaircaseField({ ...options, voiceLimit: 2 });
  const depth = 51 / 63, reading = readStaircaseRhythm(field, depth);
  const firstPair = readStaircaseRhythm(limited, depth).branches.filter(branch => branch.presence > .5);
  assert.equal(reading.white, true);
  assert.equal(reading.count, 32);
  assert.equal(firstPair.length, 2);
  assert.ok(firstPair.some(branch => branch.feature.confidence > 0
    && Math.abs(branch.feature.forkOffset) > .05 && Math.abs(branch.feature.signedTurns) > .02));
  for (const branch of firstPair) {
    assert.deepEqual(branch.feature, reading.branches.find(other => other.id === branch.id).feature);
    for (const frame of [52, 53, 54, 55, 56]) {
      assert.ok(field.overlays[frame].branches.some(other => other.id === branch.id), 'the passage keeps its two sides through black and white');
    }
  }
});
