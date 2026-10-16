import test from 'node:test';
import assert from 'node:assert/strict';
import { SPIRAL_DEFAULTS, SPIRAL_AMOUNTS, SPIRAL_RANGES, SPIRAL_STUDIES,
  normalizeSpiralStudies, selectedSpiralStudy, spiralStudyPatch } from '../src/instruments/striped-staircase-rust/spiral-studies.js';

test('focused spiral choices preserve the live instrument and expose five independent mechanisms', () => {
  const live = { ...SPIRAL_DEFAULTS, audio: true, playing: true, hold: false, progress: .43,
    clock: 190080, direction: -1, level: 0, speed: .07, pitchSource: 1, pitchMapping: 2,
    turnSpan: 2.4, accentRate: 3.5, forkSpan: 3.2, curvatureDrive: 2.5, endlessDirection: 1 };
  const signatures = new Set();
  for (const study of SPIRAL_STUDIES) {
    const patch = spiralStudyPatch(study.id), next = { ...live, ...patch };
    assert.deepEqual(Object.keys(patch), SPIRAL_AMOUNTS);
    for (const key of Object.keys(live).filter(key => !SPIRAL_AMOUNTS.includes(key))) assert.equal(next[key], live[key]);
    assert.equal(selectedSpiralStudy(next), study.id);
    signatures.add(SPIRAL_AMOUNTS.map(key => next[key]).join(','));
    if (!['original', 'braid'].includes(study.id)) assert.equal(SPIRAL_AMOUNTS.filter(key => next[key] > 0).length, 1);
  }
  assert.equal(signatures.size, SPIRAL_STUDIES.length);
  assert.equal(spiralStudyPatch('unknown'), null);
  assert.equal(spiralStudyPatch('custom'), null);
});

test('all-zero mapping is recoverable and arbitrary amount blends are represented honestly', () => {
  assert.equal(selectedSpiralStudy(SPIRAL_DEFAULTS), 'original');
  assert.equal(selectedSpiralStudy({ ...SPIRAL_DEFAULTS, turnAmount: .42, curvatureAmount: .83 }), 'custom');
  const next = { ...SPIRAL_DEFAULTS, ...spiralStudyPatch('turning'), turnSpan: 2.5 };
  assert.equal(selectedSpiralStudy(next), 'turning', 'tuning a mechanism does not select a different mechanism');
  assert.equal(selectedSpiralStudy({ ...next, ...spiralStudyPatch('original') }), 'original');
});

test('study parameters clamp hostile input and retain continuous pitch relationships', () => {
  for (const value of [NaN, Infinity, -Infinity, 'bad', undefined]) {
    const state = normalizeSpiralStudies(Object.fromEntries(Object.keys(SPIRAL_DEFAULTS).map(key => [key, value])));
    assert.deepEqual(state, SPIRAL_DEFAULTS);
  }
  for (const value of [-1e6, 1e6]) {
    const state = normalizeSpiralStudies(Object.fromEntries(Object.keys(SPIRAL_DEFAULTS).map(key => [key, value])));
    for (const [key, [low, high]] of Object.entries(SPIRAL_RANGES)) assert.ok(state[key] >= low && state[key] <= high);
  }
  const continuous = normalizeSpiralStudies({ turnSpan: 1.137, forkSpan: 2.371, accentRate: 3.141, endlessDirection: 1 });
  assert.equal(continuous.turnSpan, 1.137); assert.equal(continuous.forkSpan, 2.371);
  assert.equal(continuous.accentRate, 3.141); assert.equal(continuous.endlessDirection, 1);
});
