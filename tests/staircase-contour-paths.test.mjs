import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStaircaseContourPaths, sampleStaircaseContourPaths } from '../src/instruments/striped-staircase-rust/contour-paths.js';
import { buildStaircaseField, readStaircaseRhythm } from '../src/instruments/striped-staircase-rust/field.js';

function field(frames, paired = true) {
  const stride = 3616, table = new Float32Array(frames.length * stride);
  for (let frame = 0; frame < frames.length; frame++) for (const record of frames[frame]) {
    const { slot = 0, id, x, y, presence = 1, weight = .1, parent = 0 } = record;
    table.set([presence, x, y, weight, id, parent], frame * stride + 544 + slot * 6);
  }
  return { table, stride, frames: frames.length, pitchSource: +paired };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('motion trails follow interpolated voiced coordinates and retain paired side identity around bends', () => {
  const source = field([
    [{ id: 1, x: .2, y: .1 }, { id: 2, slot: 1, x: .8, y: .1 }],
    [{ id: 1, x: .5, y: .4 }, { id: 2, slot: 1, x: .5, y: .6 }],
    [{ id: 1, x: .8, y: .9 }, { id: 2, slot: 1, x: .2, y: .9 }],
  ]);
  const paths = buildStaircaseContourPaths(source);
  assert.equal(paths.paths.length, 2);
  assert.equal(paths.byId.get(1).tendrilId, paths.byId.get(2).tendrilId);
  assert.equal(paths.byId.get(1).side, 0); assert.equal(paths.byId.get(2).side, 1);
  assert.equal(paths.byId.get(1).runs.length, 1);
  assert.equal(paths.byId.get(1).runs[0].points.length, 6);
  const [sample] = sampleStaircaseContourPaths(paths, .75, 1);
  close(sample.cx, .65); close(sample.cy, .65);
  assert.equal(sample.side, 0); assert.equal(sample.segment.index, 1); close(sample.segment.mix, .5);
  const end = sampleStaircaseContourPaths(paths, 1, 1)[0];
  close(end.cx, .8); close(end.cy, .9);
  assert.equal(end.segment, null, 'terminal marker has no nonexistent following segment');
});

test('missing frames, unrelated IDs, and changed oscillator slots never create connecting lines', () => {
  const source = field([
    [{ id: 1, x: .1, y: .1 }],
    [{ id: 1, x: .2, y: .2, presence: 0 }],
    [{ id: 1, x: .3, y: .3 }],
    [{ id: 7, x: .9, y: .9 }],
    [{ id: 1, slot: 4, x: .4, y: .4 }],
  ]);
  const paths = buildStaircaseContourPaths(source);
  assert.deepEqual(paths.byId.get(1).runs.map(run => [run.slot, run.startFrame, run.endFrame]), [[0, 0, 0], [0, 2, 2], [4, 4, 4]]);
  const fade = sampleStaircaseContourPaths(paths, .125, 1)[0];
  close(fade.cx, .15); close(fade.presence, .5); assert.equal(fade.segment, null);
  const beforeSwitch = sampleStaircaseContourPaths(paths, .6)[0];
  assert.equal(beforeSwitch.id, 1); close(beforeSwitch.cx, .3); assert.equal(beforeSwitch.segment, null);
  const afterSwitch = sampleStaircaseContourPaths(paths, .65)[0];
  assert.equal(afterSwitch.id, 7); close(afterSwitch.cx, .9); assert.equal(afterSwitch.segment, null);
});

test('offshoots retain separate trails and their parent reference without drawing a fictional connector', () => {
  const source = field([
    [{ id: 1, x: .3, y: .2 }],
    [{ id: 1, x: .3, y: .4 }, { id: 3, slot: 2, parent: 1, x: .6, y: .4 }],
    [{ id: 1, x: .4, y: .6 }, { id: 3, slot: 2, parent: 1, x: .7, y: .6 }],
  ]);
  const paths = buildStaircaseContourPaths(source), child = paths.byId.get(3);
  assert.equal(child.parentId, 1); assert.equal(child.runs[0].startFrame, 1);
  assert.equal(child.runs[0].points.length, 4);
  close(child.runs[0].points[0], .6);
  assert.equal(sampleStaircaseContourPaths(paths, .75, 3).length, 1);
});

test('real center and paired-path queries match the current audio-table readout across the entire descent', () => {
  for (const pitchSource of [0, 1]) {
    const source = buildStaircaseField({ pitchSource, resolution: 64, voiceLimit: 32 });
    const paths = buildStaircaseContourPaths(source);
    for (let index = 0; index <= 128; index++) {
      const depth = index / 128;
      const expected = readStaircaseRhythm(source, depth).branches.filter(branch => branch.length > 0);
      const actual = sampleStaircaseContourPaths(paths, depth);
      assert.equal(actual.length, expected.length);
      for (let voice = 0; voice < expected.length; voice++) {
        assert.equal(actual[voice].id, expected[voice].id); assert.equal(actual[voice].slot, expected[voice].slot);
        close(actual[voice].cx, expected[voice].cx); close(actual[voice].cy, expected[voice].cy);
        close(actual[voice].presence, expected[voice].presence); close(actual[voice].length, expected[voice].length);
      }
    }
    const points = paths.paths.reduce((sum, path) => sum + path.runs.reduce((count, run) => count + run.points.length / 2, 0), 0);
    assert.ok(points <= 64 * 512);
  }
});

test('malformed fields fail clearly and absent or weightless voices never make trails', () => {
  assert.throws(() => buildStaircaseContourPaths({}), /Invalid staircase path field/);
  const source = field([[{ id: 1, x: .5, y: .5, weight: 0 }, { id: 2, slot: 1, x: .2, y: .3, presence: 0 }]], false);
  const paths = buildStaircaseContourPaths(source);
  assert.equal(paths.paths.length, 0); assert.deepEqual(sampleStaircaseContourPaths(paths, 0), []);
});
