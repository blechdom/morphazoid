import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HAND_DEFAULTS, TREMOR_JOINTS,
  normalizeHandConfig, randomizeHandConfig, evaluateHandPose, evaluateHandVoices,
  handEffectiveTempo, handMotionPeriod, setHandEffectiveTempo,
  handTremorTimeScale, handTremorRate, handDigitLimits, handWristLimits, FOOT_LIMITS,
} from '../src/instruments/gesticulating-hand/hand-model.js';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
import { handRhythmPhase } from '../src/instruments/gesticulating-hand/hand-rhythm.js';

const clone = value => structuredClone(value);
const rng = initial => {
  let seed = initial;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
};
const near = (actual, expected, tolerance = 1e-8, path = 'value') => {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), `${path} must be finite`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${path}: ${actual} != ${expected}`);
};
function closeStructure(actual, expected, tolerance = 1e-8, path = 'value') {
  if (typeof expected === 'number') return near(actual, expected, tolerance, path);
  if (expected === null || typeof expected !== 'object') return assert.equal(actual, expected, path);
  assert.deepEqual(Object.keys(actual), Object.keys(expected), `${path} keys`);
  for (const key of Object.keys(expected)) closeStructure(actual[key], expected[key], tolerance, `${path}.${key}`);
}
function withoutReference(value) {
  const result = clone(value);
  delete result.tremor.referenceTempo;
  return result;
}
function stationaryTargets(config, time, offset) {
  return evaluateHandVoices(config, time, undefined, undefined, undefined, time + offset)
    .map(({ excitation, ...target }) => target);
}
function rebase(config, next, time, offset) {
  const nextTime = time * handMotionPeriod(next.motion) / handMotionPeriod(config.motion);
  return {
    time: nextTime,
    offset: (time + offset) * handTremorRate(config) / handTremorRate(next) - nextTime,
  };
}
function assertBoundedPose(config, pose) {
  for (let i = 0; i < 5; i++) {
    for (const [joint, [min, max]] of Object.entries(handDigitLimits(config.form, i))) {
      const value = pose.fingers[i][joint];
      assert.ok(Number.isFinite(value) && value >= min - 1e-9 && value <= max + 1e-9,
        `${config.form} digit ${i} ${joint}: ${value} outside [${min},${max}]`);
    }
  }
  for (const [joint, [min, max]] of Object.entries(handWristLimits(config.form))) {
    const value = pose.wrist[joint];
    assert.ok(Number.isFinite(value) && value >= min - 1e-9 && value <= max + 1e-9);
  }
  if (config.form === 'foot') {
    for (const [joint, [min, max]] of Object.entries(FOOT_LIMITS.shape)) {
      const value = pose.foot[joint];
      assert.ok(Number.isFinite(value) && value >= min - 1e-9 && value <= max + 1e-9);
    }
  }
}

for (const seed of [38, 69, 103]) {
  test(`dice seed ${seed}: slowing to 2 BPM scales the whole performance and preserves edit phase`, () => {
    const config = randomizeHandConfig(HAND_DEFAULTS, rng(seed));
    const initialBpm = handEffectiveTempo(config.motion);
    assert.ok(initialBpm > 500);
    near(config.tremor.referenceTempo, initialBpm);
    assert.equal(handTremorTimeScale(config), 1);
    assert.equal(handTremorRate(config), config.tremor.rate);
    const slow = clone(config);
    setHandEffectiveTempo(slow.motion, 2);
    const ratio = 2 / initialBpm;
    assert.equal(slow.tremor.rate, config.tremor.rate);
    assert.equal(slow.tremor.referenceTempo, initialBpm);
    near(handTremorTimeScale(slow), ratio, 1e-14);
    near(handTremorRate(slow), handTremorRate(config) * ratio, 1e-14);
    const time = .37, offset = .153, paused = rebase(config, slow, time, offset);
    closeStructure(evaluateHandPose(slow, paused.time, undefined, paused.time + paused.offset),
      evaluateHandPose(config, time, undefined, time + offset));
    closeStructure(stationaryTargets(slow, paused.time, paused.offset), stationaryTargets(config, time, offset));
    for (const elapsed of [.005, .027, .14, .731]) {
      const oldTime = time + elapsed, slowTime = paused.time + elapsed / ratio;
      closeStructure(evaluateHandPose(slow, slowTime, undefined, slowTime + paused.offset),
        evaluateHandPose(config, oldTime, undefined, oldTime + offset));
      closeStructure(stationaryTargets(slow, slowTime, paused.offset), stationaryTargets(config, oldTime, offset));
      for (let digit = 0; digit < 5; digit++) {
        near(handRhythmPhase(slow.sound.rhythm, slowTime * 2 / 60, digit),
          handRhythmPhase(config.sound.rhythm, oldTime * initialBpm / 60, digit));
      }
    }
  });
}

test('legacy reference migration is stable through normalization, tempo edits, and JSON recall', () => {
  for (const seed of [38, 69, 103]) {
    const legacy = withoutReference(randomizeHandConfig(HAND_DEFAULTS, rng(seed)));
    assert.equal(legacy.tremor.referenceTempo, undefined);
    const migrated = normalizeHandConfig(legacy), reference = handEffectiveTempo(legacy.motion);
    assert.equal(migrated.tremor.referenceTempo, reference);
    assert.deepEqual(withoutReference(migrated), legacy);
    assert.deepEqual(normalizeHandConfig(migrated), migrated);
    assert.deepEqual(normalizeHandConfig(JSON.parse(JSON.stringify(migrated))), migrated);
    setHandEffectiveTempo(migrated.motion, 2);
    const recalled = normalizeHandConfig(JSON.parse(JSON.stringify(migrated)));
    assert.equal(recalled.tremor.referenceTempo, reference);
    assert.equal(recalled.tremor.rate, legacy.tremor.rate);
    assert.equal(handEffectiveTempo(recalled.motion), 2);
    closeStructure(evaluateHandPose(recalled, 13.71), evaluateHandPose(migrated, 13.71), 0);
  }
});

test('tempo and nominal-rate round trips retain phase, spread, reference, and editable rate', () => {
  for (const seed of [38, 69, 103]) {
    const original = randomizeHandConfig(HAND_DEFAULTS, rng(seed));
    let config = clone(original), time = 1.13, offset = .271;
    const initialPose = evaluateHandPose(config, time, undefined, time + offset);
    const initialTargets = stationaryTargets(config, time, offset);
    for (const bpm of [2, 4400, 120, 2, handEffectiveTempo(original.motion)]) {
      const next = clone(config); setHandEffectiveTempo(next.motion, bpm);
      ({ time, offset } = rebase(config, next, time, offset)); config = next;
      closeStructure(evaluateHandPose(config, time, undefined, time + offset), initialPose);
      closeStructure(stationaryTargets(config, time, offset), initialTargets);
      assert.deepEqual(config.tremor, original.tremor);
    }
    let next = clone(config); setHandEffectiveTempo(next.motion, 2);
    ({ time, offset } = rebase(config, next, time, offset)); config = next;
    for (const rate of [120, .1, original.tremor.rate]) {
      next = clone(config); next.tremor.rate = rate;
      ({ time, offset } = rebase(config, next, time, offset)); config = next;
      closeStructure(evaluateHandPose(config, time, undefined, time + offset), initialPose);
      closeStructure(stationaryTargets(config, time, offset), initialTargets);
      assert.equal(config.tremor.rate, rate);
      assert.equal(config.tremor.referenceTempo, original.tremor.referenceTempo);
      assert.equal(config.tremor.rateSpread, original.tremor.rateSpread);
      assert.equal(config.tremor.phaseSpread, original.tremor.phaseSpread);
      near(handTremorRate(config), rate * 2 / handEffectiveTempo(original.motion), 1e-14);
    }
  }
});

test('endpoint tempo/reference/rate combinations remain finite and within both rig limits', () => {
  for (const form of ['hand', 'foot']) for (const reference of [2, 4400]) for (const bpm of [2, 4400]) {
    for (const rate of [.1, 120]) for (const joint of TREMOR_JOINTS) {
      const config = normalizeHandConfig({ form, motion: { id: 'polyrhythmic-tangle', amount: 1, elasticity: 1 },
        tremor: { finger: 'all', joint, amount: 45, rate, rateSpread: 1, phaseSpread: 1, referenceTempo: reference } });
      setHandEffectiveTempo(config.motion, bpm);
      near(handTremorTimeScale(config), bpm / reference, 1e-14);
      near(handTremorRate(config), rate * bpm / reference, 1e-14);
      assert.ok(handTremorTimeScale(config) >= 1 / 2200 && handTremorTimeScale(config) <= 2200);
      assert.ok(handTremorRate(config) >= .1 / 2200 && handTremorRate(config) <= 264000);
      for (const time of [0, .0013, .731, 7.3, 500000, 500000.00001]) {
        assertBoundedPose(config, evaluateHandPose(config, time, undefined, time - 8.173));
        for (const voice of evaluateHandVoices(config, time, undefined, undefined, undefined, time - 8.173)) {
          for (const value of Object.values(voice)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
        }
      }
    }
  }
});

test('invalid references migrate to scene tempo and finite out-of-range references clamp', () => {
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, {}, [], 'not-a-tempo']) {
    const config = normalizeHandConfig({ motion: { tempo: 430, speed: 2.3 }, tremor: { referenceTempo: invalid } });
    assert.equal(config.tremor.referenceTempo, handEffectiveTempo(config.motion));
    assert.equal(handTremorTimeScale(config), 1);
  }
  assert.equal(normalizeHandConfig({ tremor: { referenceTempo: -1 } }).tremor.referenceTempo, 2);
  assert.equal(normalizeHandConfig({ tremor: { referenceTempo: 4401 } }).tremor.referenceTempo, 4400);
});

test('large scale does not prematurely freeze tremor by clamping scaled time', () => {
  for (const form of ['hand', 'foot']) {
    const config = normalizeHandConfig({ form, motion: { id: 'still', tempo: 1100, speed: 4 },
      tremor: { amount: 8, rate: .1, joint: 'wrist', referenceTempo: 2 } });
    const a = evaluateHandPose(config, 500000), b = evaluateHandPose(config, 500000.00001);
    assertBoundedPose(config, a); assertBoundedPose(config, b);
    assert.ok(Math.abs(a.wrist.flex - b.wrist.flex) > .01, `${form} should keep shaking after 5.26 days`);
  }
});

test('DSP and graphics share scaled pose, continuous tempo edits, and paused tremor', () => {
  for (const seed of [38, 69, 103]) {
    const config = randomizeHandConfig(HAND_DEFAULTS, rng(seed)); setHandEffectiveTempo(config.motion, 2);
    const dsp = new HandDSP(48000); dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true);
    dsp.setTransport({ time: 3.1, tremorOffset: 17.3, playing: true }, 0);
    const checkAt = at => {
      dsp.updateTargets(at);
      const time = dsp.getMotionTime(at), tremorTime = time + dsp.tremorOffset;
      closeStructure(dsp.pose, evaluateHandPose(dsp.config, time, undefined, tremorTime), 0);
      const expected = evaluateHandVoices(dsp.config, time, undefined, undefined, undefined, tremorTime);
      if (!dsp.playing) expected.forEach(voice => { voice.excitation = 0; });
      closeStructure(dsp.targets, expected, 0);
    };
    checkAt(.231);
    const before = clone(dsp.pose), next = clone(config); setHandEffectiveTempo(next.motion, 4400);
    const rebased = rebase(config, next, dsp.getMotionTime(.231), dsp.tremorOffset);
    dsp.setConfig(next); dsp.setTransport({ time: rebased.time, tremorOffset: rebased.offset, playing: true }, .231);
    checkAt(.231); closeStructure(dsp.pose, before);
    const left = new Float32Array(128), right = new Float32Array(128);
    dsp.process(left, right, .231);
    for (const value of [...left, ...right]) assert.ok(Number.isFinite(value) && Math.abs(value) <= 1);
    const lastAt = (Math.round(.231 * 48000) + 96) / 48000;
    closeStructure(dsp.pose, evaluateHandPose(dsp.config, dsp.getMotionTime(lastAt), undefined,
      dsp.getMotionTime(lastAt) + dsp.tremorOffset), 0);
    dsp.setTransport({ playing: false }, dsp.clock); checkAt(dsp.clock);
    const paused = clone(dsp.pose); checkAt(dsp.clock + 19.1);
    closeStructure(dsp.pose, paused, 0);
    assert.ok(dsp.targets.every(voice => voice.excitation === 0));
  }
});
