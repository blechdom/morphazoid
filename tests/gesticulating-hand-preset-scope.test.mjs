import test from 'node:test';
import assert from 'node:assert/strict';
import {randomizeHandConfig, normalizeHandConfig, handMotionPeriod, handDigitLimits, FOOT_LIMITS} from '../src/instruments/gesticulating-hand/hand-model.js';
import {HandDSP} from '../src/instruments/gesticulating-hand/hand-dsp.js';
import {HandOutput} from '../src/instruments/gesticulating-hand/hand-output.js';

function rng(initial) {
  let seed = initial, calls = 0;
  const random = () => { calls++; return ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32; };
  return {random, calls: () => calls};
}
function roll(seed, scope, current) {
  const stream = rng(seed);
  return {config: randomizeHandConfig(current, stream.random, scope), calls: stream.calls()};
}

test('Both retains the existing dice stream and never inherits the current rig as a restriction', () => {
  for (let seed = 1; seed <= 64; seed++) {
    const reference = roll(seed);
    for (const scope of ['both', null, 'invalid', {}]) assert.deepEqual(roll(seed, scope), reference);
    assert.deepEqual(roll(seed, 'both', normalizeHandConfig({form: 'foot'})), reference);
    assert.deepEqual(roll(seed, reference.config.form), reference, 'choosing the already drawn form consumes the identical stream');
  }
});

test('scoped dice creates complete, varied anatomy before generating shape and joint contours', () => {
  for (const form of ['hand', 'foot']) {
    const shapes = new Set(), elasticity = new Set(), motions = new Set(), loops = new Set(), scenes = new Set();
    for (let i = 1; i <= 64; i++) {
      const seed = Math.imul(i, 0x9e3779b1) >>> 0, {config} = roll(seed, form);
      assert.equal(config.form, form); assert.deepEqual(roll(seed, form).config, config);
      assert.deepEqual(config, normalizeHandConfig(config)); assert.equal('presetScope' in config, false);
      for (let finger = 0; finger < 5; finger++) for (const [key, [low, high]] of Object.entries(handDigitLimits(form, finger))) {
        assert.ok(config.pose.fingers[finger][key] >= low && config.pose.fingers[finger][key] <= high);
      }
      if (form === 'foot') {
        assert.equal(config.pose.fingers[0].pip, 0);
        for (const [key, [low, high]] of Object.entries(FOOT_LIMITS.shape)) assert.ok(config.pose.foot[key] >= low && config.pose.foot[key] <= high);
        shapes.add(JSON.stringify(config.pose.foot)); elasticity.add(config.motion.elasticity);
      } else assert.equal(config.pose.foot, undefined);
      scenes.add(JSON.stringify(config)); motions.add(config.motion.id); loops.add(config.motion.loopBeats);
    }
    assert.equal(scenes.size, 64); assert.ok(motions.size > 20 && loops.size > 20);
    if (form === 'foot') assert.ok(shapes.size > 50 && elasticity.size > 50);
  }
});

test('forcing either form retains audible ongoing dice output and bounded speaker levels', () => {
  const rate = 48000;
  for (const form of ['hand', 'foot']) for (const seed of [72, 74, 79, 4203543429, 1697034193]) {
    const {config} = roll(seed, form), dsp = new HandDSP(rate), output = new HandOutput(rate);
    dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true);
    dsp.setTransport({time: handMotionPeriod(config.motion) * .823, playing: true});
    const left = new Float32Array(128), right = new Float32Array(128); let energy = 0, peak = 0;
    for (let frame = 0; frame < rate; frame += 128) {
      dsp.process(left, right); output.process(left, right);
      for (let i = 0; i < 128; i++) {
        assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
        energy += (left[i] ** 2 + right[i] ** 2) * .5;
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
    }
    const pageRms = Math.sqrt(energy / rate) * .4;
    assert.ok(pageRms > .002, `${form}/${seed}: ${pageRms}`); assert.ok(peak <= .890001);
  }
});
