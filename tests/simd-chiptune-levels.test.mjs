import assert from 'node:assert/strict';
import test from 'node:test';
import { WEBGPU_CHIPTUNE_DEFAULTS as DEFAULTS, WEBGPU_CHIPTUNE_LIMITS as LIMITS } from '../src/instruments/webgpu-chiptune/webgpu-chiptune.js';
import {
  SIMD_CHIPTUNE_LEVEL_KEYS as LEVELS, SIMD_CHIPTUNE_DRUM_LEVELS as DRUM_LEVELS,
  SIMD_CHIPTUNE_PERFORMANCE_LANES as VOICES,
  sanitizeSimdChiptunePerformance, sanitizeSimdChiptuneDrumMix,
  applySimdChiptunePerformance, applySimdChiptuneDrumMix,
  readSimdChiptuneLevels, setSimdChiptuneLevel,
} from '../src/instruments/simd-chiptune/performance.js';

const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: ${actual} != ${expected}`);
function scene() {
  return {
    parameters: { ...DEFAULTS, upperOneLevel: .48, upperTwoLevel: 1.4, leadLevel: .7, arpLevel: 1.6,
      noiseLevel: .3, drumMix: 1.2, kickLevel: .7, snareLevel: 1.7, hatLevel: .9, shakerLevel: .6,
      bassPulseLevel: .45, bassSineLevel: 1.4 },
    performance: sanitizeSimdChiptunePerformance(Object.fromEntries(VOICES.map((lane, i) => [lane,
      { x: .1 + i * .1, y: .12 + i * .12, volume: .21 + i * .1, muted: i % 2 === 0, solo: i === 3 }]))),
    drumMix: sanitizeSimdChiptuneDrumMix({ kick: { volume: .2, muted: true }, snare: { volume: .6, solo: true },
      hats: { volume: .4 }, shaker: { volume: .7 } }),
  };
}
function audible({ parameters, performance, drumMix }) {
  return applySimdChiptuneDrumMix(applySimdChiptunePerformance(parameters, performance), drumMix);
}
function unmuted(state) {
  return {
    ...state,
    performance: Object.fromEntries(Object.entries(state.performance).map(([lane, value]) => [lane, { ...value, muted: false, solo: false }])),
    drumMix: Object.fromEntries(Object.entries(state.drumMix).map(([lane, value]) => [lane, { ...value, muted: false, solo: false }])),
  };
}
const read = state => readSimdChiptuneLevels(state.parameters, state.performance, state.drumMix);
const set = (state, lane, value) => setSimdChiptuneLevel(state.parameters, state.performance, state.drumMix, lane, value);

test('unified levels display legacy XY and trims independently of all mute/solo states without rewriting them', () => {
  const state = scene(), saved = structuredClone(state), levels = read(state), expected = audible(unmuted(state));
  for (const [lane, key] of Object.entries({ ...LEVELS, ...DRUM_LEVELS })) near(levels[lane], expected[key], lane);
  near(levels.bass, state.performance.bass.volume);
  assert.deepEqual(levels, read(unmuted(state)));
  assert.deepEqual(state, saved);
  assert.ok(Object.isFrozen(levels));
  assert.ok(levels.upperOne > 0, 'muted voice still shows the level that returns when unmuted');
  assert.ok(levels.kick > 0, 'muted drum part still shows its pre-bus level');
});

test('touching the currently displayed level preserves sound while absorbing only its owned XY/trim', () => {
  const state = scene(), before = audible(state), beforeUnmuted = audible(unmuted(state));
  for (const lane of [...Object.keys(LEVELS), ...Object.keys(DRUM_LEVELS), 'bass']) {
    const next = set(state, lane, read(state)[lane]);
    for (const key of Object.keys(DEFAULTS)) {
      near(audible(next)[key], before[key], `${lane} active ${key}`);
      near(audible(unmuted(next))[key], beforeUnmuted[key], `${lane} unmuted ${key}`);
    }
    for (const voice of VOICES) {
      assert.equal(next.performance[voice].muted, state.performance[voice].muted);
      assert.equal(next.performance[voice].solo, state.performance[voice].solo);
      assert.equal(next.performance[voice].x, state.performance[voice].x);
      if (voice !== lane || ['drums', 'bass'].includes(lane)) assert.equal(next.performance[voice].y, state.performance[voice].y);
      if (voice !== lane) assert.deepEqual(next.performance[voice], state.performance[voice]);
    }
    for (const part of Object.keys(DRUM_LEVELS)) {
      assert.equal(next.drumMix[part].muted, state.drumMix[part].muted);
      assert.equal(next.drumMix[part].solo, state.drumMix[part].solo);
      if (part !== lane) assert.deepEqual(next.drumMix[part], state.drumMix[part]);
    }
  }
});

test('single-gain voice controls recover from zero patch, zero legacy trim and a zero level axis', () => {
  for (const [lane, key] of Object.entries(LEVELS)) {
    const state = scene();
    state.parameters[key] = 0;
    state.performance = sanitizeSimdChiptunePerformance({ ...state.performance, [lane]: {
      ...state.performance[lane], y: 0, volume: 0, muted: true, solo: true,
    } });
    near(read(state)[lane], 0);
    const next = set(state, lane, .85);
    near(next.parameters[key], .85); near(read(next)[lane], .85);
    assert.equal(next.performance[lane].volume, 1);
    assert.equal(next.performance[lane].y, lane === 'drums' ? 0 : .5);
    assert.equal(next.performance[lane].x, state.performance[lane].x);
    assert.equal(next.performance[lane].muted, true); assert.equal(next.performance[lane].solo, true);
    assert.equal(audible(next)[key], 0, 'editing a muted level must not unmute it');
  }
  for (const [part, key] of Object.entries(DRUM_LEVELS)) {
    const state = scene(); state.parameters[key] = 0;
    state.drumMix = sanitizeSimdChiptuneDrumMix({ ...state.drumMix, [part]: { volume: 0, muted: true, solo: true } });
    const next = set(state, part, 1.1);
    near(next.parameters[key], 1.1); near(read(next)[part], 1.1);
    assert.equal(next.drumMix[part].volume, 1);
    assert.equal(next.drumMix[part].muted, true); assert.equal(next.drumMix[part].solo, true);
    assert.deepEqual(next.performance, state.performance);
  }
});

test('drum bus preserves decay XY, Bass trim preserves pulse/sine balance, and limits match the source ABI', () => {
  const state = scene();
  const drum = set(state, 'drums', .5);
  assert.equal(drum.performance.drums.y, state.performance.drums.y);
  near(audible(unmuted(drum)).drumDecay, audible(unmuted(state)).drumDecay);
  assert.deepEqual(drum.drumMix, state.drumMix);
  const bass = set(state, 'bass', .8);
  assert.deepEqual(bass.parameters, state.parameters);
  assert.equal(bass.performance.bass.x, state.performance.bass.x);
  assert.equal(bass.performance.bass.y, state.performance.bass.y);
  const originalBass = audible(unmuted(state)), changedBass = audible(unmuted(bass));
  near(changedBass.bassPulseLevel / originalBass.bassPulseLevel, .8 / state.performance.bass.volume);
  near(changedBass.bassSineLevel / originalBass.bassSineLevel, .8 / state.performance.bass.volume);
  for (const [lane, key] of Object.entries({ ...LEVELS, ...DRUM_LEVELS })) {
    near(read(set(state, lane, -5))[lane], 0);
    near(read(set(state, lane, 99))[lane], LIMITS[key][1]);
  }
  near(read(set(state, 'bass', 99)).bass, 1);
  near(read(set(state, 'bass', -5)).bass, 0);
  near(read(set(state, 'lead', NaN)).lead, read(state).lead);
  assert.throws(() => set(state, 'unknown', 1), RangeError);
  assert.throws(() => set(state, 'toString', 1), RangeError);
});
