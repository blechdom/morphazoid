import test from 'node:test';
import assert from 'node:assert/strict';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
import {
  HAND_PRESETS, FOOT_LIMITS, normalizeHandConfig, randomizeHandConfig, handPoseForForm,
  handJointKeys, handDigitLimits, handWristLimits, handMotionPeriod, setHandEffectiveTempo,
  handContourScale, captureHandContours, evaluateHandPose, evaluateHandVoices, createHandPose,
} from '../src/instruments/gesticulating-hand/hand-model.js';
import { HAND_CONTOUR_POINTS, HAND_CONTOUR_BEATS } from '../src/instruments/gesticulating-hand/hand-contour.js';

const JOINTS = ['mcp', 'pip', 'dip', 'spread'];
const clone = value => structuredClone(value);
const wave = (depth = .25, phase = 0) => Array.from({ length: HAND_CONTOUR_POINTS }, (_, i) => depth * Math.sin(i / HAND_CONTOUR_POINTS * Math.PI * 2 + phase));
const seeded = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32;
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const poseValues = pose => [...pose.fingers.flatMap(finger => JOINTS.map(key => finger[key])), ...Object.values(pose.wrist), ...Object.values(pose.foot ?? {})];
function closePose(actual, expected, tolerance = 1e-8) {
  const a = poseValues(actual), b = poseValues(expected);
  assert.equal(a.length, b.length);
  a.forEach((value, i) => close(value, b[i], tolerance));
}
function fixture(form = 'hand') {
  return normalizeHandConfig({ form, pose: handPoseForForm('relaxed', form),
    motion: { id: 'still', custom: true, tempo: 60, speed: 1, amount: .7, elasticity: 0 },
    sound: { rhythm: 'continuous', rootHz: 181, brightness: .45, roughness: .25, space: 0, rotationFx: 0, attack: .008, release: .08 },
    tremor: { amount: 0 }, voices: Array.from({ length: 5 }, () => ({ source: 'wire', level: .65 })) });
}
function checkBounds(config, pose) {
  for (let i = 0; i < 5; i++) for (const [key, [min, max]] of Object.entries(handDigitLimits(config.form, i))) {
    assert.ok(Number.isFinite(pose.fingers[i][key]) && pose.fingers[i][key] >= min && pose.fingers[i][key] <= max, `${config.form} ${i} ${key}`);
  }
  for (const [key, [min, max]] of Object.entries(handWristLimits(config.form))) assert.ok(pose.wrist[key] >= min && pose.wrist[key] <= max);
  if (config.form === 'foot') {
    assert.equal(pose.fingers[0].pip, 0);
    for (const [key, [min, max]] of Object.entries(FOOT_LIMITS.shape)) assert.ok(Number.isFinite(pose.foot[key]) && pose.foot[key] >= min && pose.foot[key] <= max);
  }
}
function engine(config) {
  const dsp = new HandDSP(24000);
  dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true); dsp.setTransport({ time: .3, playing: true });
  return dsp;
}
function render(dsp, seconds = .4) {
  const channels = [new Float32Array(Math.round(seconds * dsp.sampleRate)), new Float32Array(Math.round(seconds * dsp.sampleRate))];
  for (let frame = 0; frame < channels[0].length; frame += 128) dsp.process(channels[0].subarray(frame, frame + 128), channels[1].subarray(frame, frame + 128));
  for (const channel of channels) assert.ok(channel.every(sample => Number.isFinite(sample) && Math.abs(sample) < 1));
  return channels;
}
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const audioDifference = (a, b) => Math.max(...a.map((channel, i) => rms(channel.map((value, j) => value - b[i][j]))));

test('drawn motion normalization owns five independent bounded joint curves and defaults to disabled', () => {
  const plain = normalizeHandConfig();
  assert.equal(plain.motion.custom, false);
  assert.equal(plain.motion.contours.length, 5);
  for (const digit of plain.motion.contours) {
    assert.deepEqual(Object.keys(digit), JOINTS);
    for (const curve of Object.values(digit)) assert.deepEqual(curve, Array(HAND_CONTOUR_POINTS).fill(0));
  }
  const hostile = normalizeHandConfig({ motion: { custom: 'true', contours: [
    { mcp: [NaN, Infinity, -Infinity, Symbol(), 8, -9, '.4'], pip: Array(400).fill(2), spread: {} }, null,
  ] } });
  assert.equal(hostile.motion.custom, false);
  assert.deepEqual(hostile.motion.contours[0].mcp.slice(0, 7), [0, 0, 0, 0, 1, -1, .4]);
  assert.deepEqual(hostile.motion.contours[0].pip, Array(HAND_CONTOUR_POINTS).fill(1));
  for (const digit of hostile.motion.contours) for (const curve of Object.values(digit)) {
    assert.equal(curve.length, HAND_CONTOUR_POINTS);
    assert.ok(curve.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  }
  plain.motion.contours[0].mcp[0] = .9;
  assert.equal(plain.motion.contours[1].mcp[0], 0);
  assert.equal(plain.motion.contours[0].pip[0], 0);
  assert.equal(normalizeHandConfig().motion.contours[0].mcp[0], 0);
});

test('each real joint lane changes only its selected visible joint and the corresponding voice target', () => {
  const destination = { mcp: 'frequency', pip: 'brightness', dip: 'roughness', spread: 'pan' };
  for (const form of ['hand', 'foot']) for (let finger = 0; finger < 5; finger++) for (const joint of handJointKeys(form, finger)) {
    const config = fixture(form), before = evaluateHandPose(config, 1), soundBefore = evaluateHandVoices(config, 1);
    config.motion.contours[finger][joint] = wave();
    const after = evaluateHandPose(config, 1), soundAfter = evaluateHandVoices(config, 1);
    assert.ok(handContourScale(form, finger, joint) > 0);
    assert.ok(after.fingers[finger][joint] > before.fingers[finger][joint] + .3, `${form}/${finger}/${joint}: visible`);
    const negative = evaluateHandPose(config, 3);
    assert.ok(negative.fingers[finger][joint] < before.fingers[finger][joint] - .3, `${form}/${finger}/${joint}: negative offset`);
    for (let i = 0; i < 5; i++) for (const key of JOINTS) if (i !== finger || key !== joint) close(after.fingers[i][key], before.fingers[i][key]);
    assert.deepEqual(after.wrist, before.wrist);
    assert.deepEqual(after.foot, before.foot);
    assert.ok(soundAfter[finger][destination[joint]] > soundBefore[finger][destination[joint]], `${form}/${finger}/${joint}: sound`);
    for (let i = 0; i < 5; i++) if (i !== finger) assert.deepEqual(soundAfter[i], soundBefore[i]);
    checkBounds(config, after);
  }
});

test('drawn knuckle, middle, tip and spread loops reach rendered stereo audio on both rigs', () => {
  for (const form of ['hand', 'foot']) {
    const base = fixture(form);
    base.voices.forEach((voice, i) => { voice.level = i === 2 ? .8 : 0; });
    const reference = render(engine(base));
    assert.ok(rms(reference[0]) > .005);
    for (const joint of JOINTS) {
      const config = clone(base); config.motion.contours[2][joint] = wave(.4);
      assert.ok(audioDifference(reference, render(engine(config))) > .0002, `${form}/${joint}: rendered destination`);
    }
  }
});

test('a curve for the nonexistent big-toe middle joint remains inert', () => {
  const config = fixture('foot'), altered = clone(config);
  altered.motion.contours[0].pip = Array(HAND_CONTOUR_POINTS).fill(1);
  assert.equal(handContourScale('foot', 0, 'pip'), 0);
  assert.ok(!handJointKeys('foot', 0).includes('pip'));
  for (let time = 0; time < 4; time += .137) {
    const pose = evaluateHandPose(altered, time);
    assert.equal(pose.fingers[0].pip, 0);
    assert.deepEqual(pose, evaluateHandPose(config, time));
    assert.deepEqual(evaluateHandVoices(altered, time), evaluateHandVoices(config, time));
  }
});

test('drawn loops use four beats, remain bounded at every tempo, and reuse pose storage', () => {
  for (const form of ['hand', 'foot']) {
    const config = fixture(form); config.motion.id = 'count'; config.motion.amount = 1;
    config.motion.elasticity = form === 'foot' ? .65 : 0;
    for (let finger = 0; finger < 5; finger++) for (const [index, joint] of JOINTS.entries()) config.motion.contours[finger][joint] = wave(1, finger * .47 + index * .7);
    const reference = evaluateHandPose(config, handMotionPeriod(config.motion) * .237);
    for (const bpm of [2, 60, 137.5, 1100, 4400]) {
      setHandEffectiveTempo(config.motion, bpm);
      const period = handMotionPeriod(config.motion);
      close(period, HAND_CONTOUR_BEATS * 60 / bpm);
      closePose(evaluateHandPose(config, period * .237), reference);
      closePose(evaluateHandPose(config, period * 1.237), reference);
      closePose(evaluateHandPose(config, period * (1 - 1e-7)), evaluateHandPose(config, period * 1e-7), .001);
      const out = createHandPose(), fingers = out.fingers, wrist = out.wrist;
      for (let point = 0; point <= 64; point++) {
        assert.equal(evaluateHandPose(config, period * point / 64, out), out);
        assert.equal(out.fingers, fingers); assert.equal(out.wrist, wrist);
        checkBounds(config, out);
      }
    }
  }
});

test('disabled custom curves leave every existing scene and its sound targets unchanged', () => {
  for (const { id, snapshot } of HAND_PRESETS) {
    const withCurves = clone(snapshot); withCurves.motion.custom = false;
    for (let i = 0; i < 5; i++) for (const joint of JOINTS) withCurves.motion.contours[i][joint] = wave(.9, i * .7);
    const withoutCurves = clone(snapshot); delete withoutCurves.motion.contours; delete withoutCurves.motion.custom;
    for (const time of [.013, .39, 1.17]) {
      assert.deepEqual(evaluateHandPose(withCurves, time), evaluateHandPose(withoutCurves, time), id);
      assert.deepEqual(evaluateHandVoices(withCurves, time), evaluateHandVoices(withoutCurves, time), id);
    }
  }
  for (const form of ['hand', 'foot']) {
    const config = fixture(form); config.motion.custom = false; config.motion.id = 'wave';
    const reference = render(engine(config));
    for (const digit of config.motion.contours) for (const joint of JOINTS) digit[joint] = wave(.8);
    assert.deepEqual(render(engine(config)), reference, `${form}: disabled curves preserve audio samples`);
  }
});

test('capture preserves authored digit offsets at all sixteen knots and converts their cycle to four beats', () => {
  for (const form of ['hand', 'foot']) for (const id of ['wave', 'pinch', 'count', 'finger-drumming', 'source-grasp']) {
    const config = fixture(form); config.motion.custom = false; config.motion.id = id; config.motion.amount = .38;
    const saved = clone(config), sourcePeriod = handMotionPeriod(config.motion);
    const captured = normalizeHandConfig(JSON.parse(JSON.stringify({ ...config, motion: { ...config.motion, custom: true, contours: captureHandContours(config) } })));
    assert.deepEqual(config, saved, `${form}/${id}: capture is pure`);
    const drawnPeriod = handMotionPeriod(captured.motion);
    for (let point = 0; point < HAND_CONTOUR_POINTS; point++) {
      const original = evaluateHandPose(config, sourcePeriod * point / HAND_CONTOUR_POINTS);
      const drawn = evaluateHandPose(captured, drawnPeriod * point / HAND_CONTOUR_POINTS);
      for (let finger = 0; finger < 5; finger++) for (const joint of JOINTS) {
        assert.ok(Math.abs(drawn.fingers[finger][joint] - original.fingers[finger][joint]) < 1e-9,
          `${form}/${id}: knot ${point}, digit ${finger}, ${joint}: ${drawn.fingers[finger][joint]} != ${original.fingers[finger][joint]}`);
      }
    }
  }
});

test('capture excludes tremor and note taps, returns editable copies, and handles zero movement', () => {
  const config = fixture('foot'); config.motion.custom = false; config.motion.id = 'finger-roll';
  const plain = captureHandContours(config);
  config.tremor = { finger: 'all', joint: 'whole', amount: 35, rate: 19, rateSpread: .6, phaseSpread: .8 };
  config.sound.rhythm = 'broken'; config.sound.noteLength = .6;
  assert.deepEqual(captureHandContours(config), plain);
  config.motion.custom = true; config.motion.contours = plain;
  const second = captureHandContours(config);
  assert.deepEqual(second, plain); second[1].mcp[0] += .1;
  assert.notEqual(second[1].mcp[0], config.motion.contours[1].mcp[0]);
  config.motion.custom = false; config.motion.amount = 0;
  for (const digit of captureHandContours(config)) for (const curve of Object.values(digit)) assert.ok(curve.every(value => value === 0));
});

test('drawn animation save/load retains exact evaluated poses and sound while randomization covers every lane', () => {
  const seenModes = new Set(), seenForms = new Set();
  assert.deepEqual(randomizeHandConfig(undefined, seeded(42)), randomizeHandConfig(undefined, seeded(42)));
  for (let seed = 1; seed <= 32; seed++) {
    const config = randomizeHandConfig(undefined, seeded(seed));
    seenModes.add(config.motion.custom); seenForms.add(config.form);
    const signatures = new Set();
    for (const digit of config.motion.contours) for (const curve of Object.values(digit)) {
      assert.equal(curve.length, HAND_CONTOUR_POINTS);
      assert.ok(curve.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
      assert.ok(Math.max(...curve) - Math.min(...curve) > .2);
      signatures.add(JSON.stringify(curve));
    }
    assert.equal(signatures.size, 20);
    config.motion.custom = true;
    const loaded = normalizeHandConfig(JSON.parse(JSON.stringify(config)));
    assert.deepEqual(loaded, config);
    for (const time of [0, .079, .51, 1.9]) {
      assert.deepEqual(evaluateHandPose(loaded, time), evaluateHandPose(config, time));
      assert.deepEqual(evaluateHandVoices(loaded, time), evaluateHandVoices(config, time));
      checkBounds(loaded, evaluateHandPose(loaded, time));
    }
  }
  assert.deepEqual(seenModes, new Set([false, true]));
  assert.deepEqual(seenForms, new Set(['hand', 'foot']));
});
