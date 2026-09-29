import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAND_DEFAULTS, createHandPose, evaluateHandPose, handAnimationBounds,
  handAnimationLanes, handAnimationValue, handMotionPeriod, handTremorRate,
  normalizeHandConfig, setHandAnimationEdit, setHandEffectiveTempo,
} from '../src/instruments/gesticulating-hand/hand-model.js';
import {
  HAND_ANIMATION_DISPLAY_MAX_COLUMNS, HAND_ANIMATION_DISPLAY_MAX_SAMPLES,
  sampleHandAnimationDisplay,
} from '../src/instruments/gesticulating-hand/hand-animation-display.js';

const wave = (depth = .12, phase = 0) => Array.from({ length: 16 }, (_, index) => depth * Math.sin(index * Math.PI / 8 + phase));
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function assertAnchors(config, display) {
  const pose = createHandPose();
  for (let column = 0; column <= display.columns; column++) {
    const time = display.startTime + display.period * column / display.columns;
    evaluateHandPose(config, time, pose, time + display.tremorOffset, time + display.rhythmOffset);
    for (const { index, keys, curves } of display.lanes) for (const key of keys) {
      assert.equal(curves[key].values[column], handAnimationValue(pose, index, key), `${index}/${key}/${column}`);
    }
  }
}
function assertEnvelopes(config, display) {
  for (const { index, keys, curves } of display.lanes) for (const key of keys) {
    const curve = curves[key], [low, high] = handAnimationBounds(config.form, index, key);
    assert.ok(curve.values instanceof Float64Array && curve.min instanceof Float64Array && curve.max instanceof Float64Array);
    assert.equal(curve.values.length, display.columns + 1);
    assert.equal(curve.min.length, display.columns);
    assert.equal(curve.max.length, display.columns);
    for (const array of [curve.values, curve.min, curve.max]) {
      assert.ok(array.every(value => Number.isFinite(value) && value >= low && value <= high), `${index}/${key}: bounds`);
    }
    for (let column = 0; column < display.columns; column++) {
      assert.ok(curve.min[column] <= Math.min(curve.values[column], curve.values[column + 1]), `${index}/${key}: both lower anchors`);
      assert.ok(curve.max[column] >= Math.max(curve.values[column], curve.values[column + 1]), `${index}/${key}: both upper anchors`);
      assert.ok(curve.min[column] <= curve.max[column]);
    }
  }
}
function tremorScene(rate) {
  const config = normalizeHandConfig({ motion: { id: 'still', tempo: 60, speed: 1 },
    tremor: { finger: 'middle', joint: 'tip', amount: 20, rate, referenceTempo: 60 } });
  config.pose.fingers[2].dip = 40;
  return config;
}

test('display anchors retain exact source, procedural and custom model positions after all animation layers', () => {
  for (const id of ['source-grasp', 'frantic-orbit', 'drawn']) {
    const config = normalizeHandConfig({
      motion: { id: id === 'drawn' ? 'count' : id, custom: id === 'drawn', tempo: 137, speed: .7, amount: .73, loopBeats: 13 },
      tremor: { amount: 7.3, rate: 11.7, joint: 'whole', rateSpread: .5, phaseSpread: .3 },
      sound: { rhythm: 'three-four', noteLength: .34 },
    });
    if (id === 'drawn') for (let digit = 0; digit < 5; digit++) {
      for (const joint of ['mcp', 'pip', 'dip', 'spread']) config.motion.contours[digit][joint] = wave(.4, digit * .47);
    }
    setHandAnimationEdit(config, 1, 'pip', wave(.12, .9));
    setHandAnimationEdit(config, 5, 'twist', wave(.08, .2));
    const display = sampleHandAnimationDisplay(config, { startTime: .173, period: handMotionPeriod(config.motion) * .73, columns: 79, tremorOffset: -.107, rhythmOffset: .319 });
    assertAnchors(config, display);
    assertEnvelopes(config, display);
    assert.ok(display.lanes.some(({ curves }) => Object.values(curves).some(({ values }) => Math.abs(values[0] - values.at(-1)) > .1)), 'endpoint is evaluated at its own time');
  }
});

test('display uses the separate tremor time offset at every boundary', () => {
  const config = tremorScene(7.1), options = { startTime: .125, period: 1.31, columns: 31 };
  const plain = sampleHandAnimationDisplay(config, options);
  const offset = sampleHandAnimationDisplay(config, { ...options, tremorOffset: .371 });
  assertAnchors(config, offset);
  assert.notDeepEqual(offset.lanes[2].curves.dip.values, plain.lanes[2].curves.dip.values);
  assert.deepEqual(offset.lanes[0].curves.mcp.values, plain.lanes[0].curves.mcp.values);
});

test('foot display covers every real joint, ankle and shape lane with final edits and rig bounds', () => {
  const config = normalizeHandConfig({ form: 'foot', motion: { id: 'scatter', amount: .8, elasticity: .65 },
    tremor: { amount: 45, rate: 120, joint: 'wrist', rateSpread: 1, phaseSpread: 1 }, sound: { rhythm: 'walk' } });
  for (const { index, keys } of handAnimationLanes('foot')) for (const key of keys) {
    setHandAnimationEdit(config, index, key, wave(.19, index * .61));
  }
  const display = sampleHandAnimationDisplay(config, { startTime: .127, period: 2.31, columns: 96, tremorOffset: -.043 });
  assert.equal(display.lanes.length, 7);
  assert.deepEqual(display.lanes[0].keys, ['mcp', 'dip', 'spread']);
  assert.equal(display.lanes[0].curves.pip, undefined);
  assert.deepEqual(display.lanes[5].keys, ['flex', 'side', 'twist']);
  assert.deepEqual(display.lanes[6].keys, ['arch', 'twist', 'stretch']);
  assertAnchors(config, display);
  assertEnvelopes(config, display);
  const without = structuredClone(config); without.motion.edits = {};
  const plain = sampleHandAnimationDisplay(without, display);
  for (const index of [5, 6]) for (const key of display.lanes[index].keys) {
    assert.notDeepEqual(display.lanes[index].curves[key].values, plain.lanes[index].curves[key].values, `${index}/${key}: correction is displayed`);
  }
});

test('long loops retain every short rhythmic tap even when regular samples miss its peak', () => {
  for (const rhythm of ['walk', 'offbeat', 'broken', 'three-four']) {
    const config = normalizeHandConfig({ motion: { id: 'still', tempo: 120, speed: 1, loopBeats: 64 },
      tremor: { amount: 0 }, sound: { rhythm, noteLength: .08 } });
    for (const rhythmOffset of [0, -.125, .317]) {
      const display = sampleHandAnimationDisplay(config, { columns: 192, rhythmOffset });
      assert.ok(display.samples <= HAND_ANIMATION_DISPLAY_MAX_SAMPLES);
      let taps = 0;
      for (let finger = 0; finger < 5; finger++) {
        const rate = rhythm === 'three-four' ? [1, 3, 4, 2, 1][finger] / 4 : rhythm === 'walk' ? 2 : 4;
        const offset = rhythm === 'three-four' && finger > 2 ? .5 : 0;
        for (let cell = 0; cell <= Math.ceil((display.period + rhythmOffset) * 2 * rate + offset); cell++) {
          const time = (cell + .04 - offset) / (2 * rate) - rhythmOffset;
          if (time < 0 || time >= display.period || time + rhythmOffset < 0) continue;
          const pose = evaluateHandPose(config, time, undefined, time, time + rhythmOffset);
          const actual = pose.fingers[finger].mcp, base = config.pose.fingers[finger].mcp;
          if (actual < base + 1) continue;
          taps++;
          const column = Math.floor(time / display.period * display.columns);
          assert.ok(display.lanes[finger].curves.mcp.max[column] >= actual - 1e-6, `${rhythm}/${rhythmOffset}/${finger}/${cell}: tap vanished`);
        }
      }
      assert.ok(taps > 50, `${rhythm}: full phrase checked`);
      assertAnchors(config, display);
      assertEnvelopes(config, display);
    }
  }
});

test('pixel envelopes retain a tremor whose display anchors all land at zero crossings', () => {
  const config = tremorScene(32);
  const display = sampleHandAnimationDisplay(config, { startTime: 0, period: 4, columns: 128 });
  const curve = display.lanes[2].curves.dip;
  assert.ok(curve.values.every(value => Math.abs(value - 40) < 1e-10), 'anchors alone would hide this tremor');
  assert.ok(curve.min.every(value => value < 24), 'interior samples retain downward deflection in every bin');
  assert.ok(curve.max.every(value => value > 56), 'interior samples retain upward deflection in every bin');
  assertEnvelopes(config, display);
});

test('budget-saturated high-frequency envelopes remain deterministic and visibly wide', () => {
  const config = tremorScene(120); setHandEffectiveTempo(config.motion, 2048);
  assert.equal(handTremorRate(config), 4096);
  const options = { startTime: 0, period: 4, columns: 128 };
  const display = sampleHandAnimationDisplay(config, options), curve = display.lanes[2].curves.dip;
  assert.ok(curve.values.every(value => Math.abs(value - 40) < 1e-8));
  const visible = Array.from(curve.min, (min, index) => curve.max[index] - min).filter(span => span > 32).length;
  assert.ok(visible >= display.columns * .95, `${visible} bins retained a substantial tremor envelope`);
  assert.ok(display.samples <= HAND_ANIMATION_DISPLAY_MAX_SAMPLES && display.samples > 3900);
  assert.deepEqual(sampleHandAnimationDisplay(config, options), display);
});

test('actual shared model evaluation count stays bounded for hostile windows and all seven lanes', () => {
  const config = normalizeHandConfig({ form: 'foot', motion: { id: 'still', tempo: 1100, speed: 4 },
    tremor: { amount: 45, rate: 120, rateSpread: 1, referenceTempo: 2 }, sound: { rhythm: 'broken', noteLength: .08 } });
  const pose = config.pose; let evaluations = 0;
  Object.defineProperty(config, 'pose', { enumerable: true, get() { evaluations++; return pose; } });
  for (const columns of [1, 128, 256, 1e300, -30, NaN, Symbol()]) {
    evaluations = 0;
    const display = sampleHandAnimationDisplay(config, { columns, startTime: 1e300, period: 1e300, tremorOffset: -1e300 });
    assert.equal(display.samples, evaluations, 'each evaluation is shared across the lanes');
    assert.ok(evaluations > display.columns && evaluations <= HAND_ANIMATION_DISPLAY_MAX_SAMPLES);
    assert.ok(display.columns >= 1 && display.columns <= HAND_ANIMATION_DISPLAY_MAX_COLUMNS);
    assert.ok(display.startTime >= 0 && display.startTime + display.period <= 1e9);
    assertEnvelopes(config, display);
  }
});

test('sampling is read-only, repeatable, and safe with missing or malformed display options', () => {
  const config = normalizeHandConfig({ motion: { id: 'finger-roll' }, tremor: { amount: 9, rate: 23.17 } });
  setHandAnimationEdit(config, 2, 'mcp', wave());
  const before = structuredClone(config); freeze(config);
  const first = sampleHandAnimationDisplay(config, { startTime: .7, period: 1.3 });
  assert.equal(first.columns, 128);
  assert.deepEqual(sampleHandAnimationDisplay(config, { startTime: .7, period: 1.3 }), first);
  assert.deepEqual(config, before);
  for (const options of [undefined, null, Symbol(), false, { period: NaN, columns: Infinity, startTime: Symbol(), tremorOffset: {}, rhythmOffset: Symbol() }]) {
    const display = sampleHandAnimationDisplay(null, options);
    assert.equal(display.period, handMotionPeriod(HAND_DEFAULTS.motion));
    assert.equal(display.columns, 128);
    assert.equal(display.startTime, 0);
    assert.equal(display.tremorOffset, 0);
    assert.equal(display.rhythmOffset, 0);
    assertAnchors(HAND_DEFAULTS, display);
    assertEnvelopes(HAND_DEFAULTS, display);
  }
});
