import assert from 'node:assert/strict';
import test from 'node:test';
import { branchFrame, branchShape, branchPitch, wrapDegrees } from '../src/instruments/fractal-signals/branch-geometry.js';
import { MODES, PARAMS, MAX_POINTS, createDefaultState, generateStructure, sanitizeState } from '../src/instruments/fractal-signals/model.js';
import { FACTORY_PRESETS, randomizeState } from '../src/instruments/fractal-signals/presets.js';

const close = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const freq = (state, pitch) => Math.max(20, Math.min(20000, state.base * 2 ** ((state.pitchInvert ? -pitch : pitch) * state.span)));
const withoutPitch = ({ freq, ...event }) => event;
const withoutHeight = ({ y, ...point }) => point;

test('branch angle wraps complete turns and invalid values preserve the zero-angle default', () => {
  assert.equal(PARAMS.branchAngle.default, 0);
  for (const value of [0, -0, -Number.MIN_VALUE, 360, -360, 720, undefined, NaN, Infinity, -Infinity, '90']) assert.equal(wrapDegrees(value), 0);
  for (const [input, expected] of [[-1, 359], [361, 1], [-721, 359], [90.125, 90.125], [1080.5, .5]]) {
    assert.equal(wrapDegrees(input), expected);
    assert.equal(sanitizeState({ mode: 'grammar', branchAngle: input }).branchAngle, expected);
  }
  const base = createDefaultState('grammar');
  for (const angle of [-720, -360, 0, 360, 720]) assert.deepEqual(generateStructure({ ...base, branchAngle: angle }), generateStructure(base));
  for (const { id } of MODES) assert.equal(createDefaultState(id).branchAngle, 0);
  assert.notEqual(randomizeState(base, () => 0).branchAngle, randomizeState(base, () => .99).branchAngle);
});

test('branch projections equal directly rotated segment sums on a known tree', () => {
  const state = { ...createDefaultState('grammar'), depth: 2, branch: 2, x: .6, y: .4, turns: 1.7, roughness: .5, pitchInvert: true };
  const contraction = .62 + state.y * .38, spread = .22 + state.x * .7;
  const turn = Math.PI * 2 * state.turns / state.depth * (.3 + state.x * .7);
  const hash = (index, seed) => {
    let value = Math.imul(index | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  const bearings = [0, 0, ...[.22, 1, -1].map((side, child) => turn * side + (hash(1 + child * 61, state.seed + 7) - .5) * state.roughness * .23)];
  for (const branchAngle of [0, 27, 90, 179, 270, 359.9]) {
    const radians = branchAngle * Math.PI / 180, structure = generateStructure({ ...state, branchAngle });
    const stem = Math.sin(radians) * spread;
    const rawY = [0, stem, ...bearings.slice(2).map(bearing => stem + Math.sin(bearing + radians) * contraction * spread)];
    const maxY = Math.max(.35, ...rawY.map(Math.abs));
    assert.equal(structure.points.length, 5);
    for (let i = 0; i < rawY.length; i++) close(structure.points[i].y, .5 + rawY[i] / maxY * .42);
    for (const event of structure.events) {
      const i = event.point, pitch = (structure.points[i].y - .5) * 1.8 + Math.sin(bearings[i] + radians) * .12;
      close(event.freq, freq(state, pitch), 1e-9);
    }
  }
});

test('a reusable branch frame retunes the existing geometry without changing topology or phrasing', () => {
  const scenes = [createDefaultState('grammar'), ...FACTORY_PRESETS.filter(p => p.snapshot.mode === 'grammar').map(p => p.snapshot),
    { ...createDefaultState('grammar'), depth: 24, branch: 8, y: 1, roughness: 1.8, turns: 12, timingBend: .6, direction: -1 }];
  const frame = {};
  for (const state of scenes) {
    const original = generateStructure(state), geometry = original.branchGeometry;
    assert.equal(geometry.length, original.points.length); assert.ok(geometry.length <= MAX_POINTS);
    for (const branchAngle of [0, 30, 90, 155.25, 270, 359.999]) {
      assert.equal(branchFrame(geometry, branchAngle, frame), frame);
      const staticScore = generateStructure({ ...state, branchAngle });
      assert.deepEqual(staticScore.branchGeometry, geometry);
      assert.deepEqual(staticScore.edges, original.edges);
      assert.deepEqual(staticScore.points.map(withoutHeight), original.points.map(withoutHeight));
      assert.deepEqual(staticScore.events.map(withoutPitch), original.events.map(withoutPitch));
      for (let i = 0; i < original.points.length; i++) {
        const y = branchShape(geometry, i, frame);
        assert.equal(y, staticScore.points[i].y); assert.ok(y >= .079999999 && y <= .920000001);
      }
      for (const event of staticScore.events) assert.equal(freq(state, branchPitch(geometry, event.point, frame)), event.freq);
    }
    assert.notDeepEqual(generateStructure({ ...state, branchAngle: 90 }).events, original.events);
  }
});

test('complete rotations stay bounded and continuous across the circular seam', () => {
  const structure = generateStructure({ ...createDefaultState('grammar'), depth: 24, branch: 8, turns: 9, y: 1 });
  const geometry = structure.branchGeometry, frame = {};
  for (let angle = -360; angle <= 720; angle += 7.5) {
    branchFrame(geometry, angle, frame);
    assert.ok(Number.isFinite(frame.maxY) && frame.maxY >= .35);
    for (let i = 0; i < geometry.length; i++) {
      const shape = branchShape(geometry, i, frame), pitch = branchPitch(geometry, i, frame);
      assert.ok(Number.isFinite(shape) && shape >= .07999999 && shape <= .92000001);
      assert.ok(Number.isFinite(pitch) && Math.abs(pitch) <= .87600001);
    }
  }
  const before = branchFrame(geometry, 359.999), after = branchFrame(geometry, .001);
  for (let i = 0; i < geometry.length; i++) {
    close(branchShape(geometry, i, before), branchShape(geometry, i, after), .001);
    close(branchPitch(geometry, i, before), branchPitch(geometry, i, after), .002);
  }
  for (const { id } of MODES.filter(mode => mode.id !== 'grammar')) {
    assert.deepEqual(generateStructure({ ...createDefaultState(id), branchAngle: 217 }), generateStructure(createDefaultState(id)));
  }
});

test('missing or malformed branch metadata remains finite and projections stay within the explicit point budget', () => {
  for (const geometry of [undefined, null, [], [{ ySin: NaN, yCos: Infinity, bearingSin: NaN }]]) {
    const frame = branchFrame(geometry, NaN);
    assert.deepEqual(frame, { angle: 0, cos: 1, sin: 0, maxY: .35 });
    assert.equal(branchShape(geometry, 0, frame), .5); assert.equal(branchPitch(geometry, 0, frame), 0);
  }
  const geometry = Array.from({ length: MAX_POINTS + 1 }, () => ({ ySin: 0, yCos: 0, bearingSin: 0, bearingCos: 1 }));
  geometry[MAX_POINTS].ySin = 1000;
  const frame = branchFrame(geometry, 0);
  assert.equal(frame.maxY, .35);
  assert.equal(branchShape(geometry, MAX_POINTS, frame), .5);
  assert.equal(branchShape(geometry, -1, frame), .5);
});
