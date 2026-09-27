import test from 'node:test';
import assert from 'node:assert/strict';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
import {
  HAND_DEFAULTS, HAND_PRESETS, VOICE_SOURCES, normalizeHandConfig, randomizeHandConfig,
  handAnimationLanes, handAnimationBounds, handAnimationValue, handJointLabel,
  getHandAnimationEdit, setHandAnimationEdit, handPoseForForm, handMotionPeriod,
  handEffectiveTempo, handTremorRate, setHandEffectiveTempo, evaluateHandPose, evaluateHandVoices,
} from '../src/instruments/gesticulating-hand/hand-model.js';
import { HAND_CONTOUR_POINTS } from '../src/instruments/gesticulating-hand/hand-contour.js';
import { normalizeHandMotionEdits } from '../src/instruments/gesticulating-hand/hand-motion-edits.js';

const clone = value => structuredClone(value);
const constant = value => Array(HAND_CONTOUR_POINTS).fill(value);
const wave = (depth = .04) => Array.from({ length: HAND_CONTOUR_POINTS }, (_, i) => depth * Math.sin(i / HAND_CONTOUR_POINTS * Math.PI * 2));
const seeded = initial => {
  let seed = initial;
  return () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32;
};
const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const address = (pose, index) => index < 5 ? pose.fingers[index] : pose[index === 5 ? 'wrist' : 'foot'];
const toneChanged = (a, b) => ['frequency', 'brightness', 'roughness', 'pan'].some(key => Math.abs(a[key] - b[key]) > 1e-8);
function fixture(form = 'hand') {
  return normalizeHandConfig({ form, pose: handPoseForForm('relaxed', form),
    motion: { id: 'still', custom: false, tempo: 60, speed: 1, amount: 0, elasticity: 0 },
    sound: { rhythm: 'continuous', rootHz: 181, brightness: .45, roughness: .25, space: 0,
      rotationFx: 0, attack: .008, release: .08 },
    tremor: { amount: 0 }, voices: Array.from({ length: 5 }, () => ({ source: 'wire', level: .65 })) });
}
function checkBounds(config, pose) {
  for (const lane of handAnimationLanes(config.form)) for (const joint of lane.keys) {
    const value = handAnimationValue(pose, lane.index, joint), [min, max] = handAnimationBounds(config.form, lane.index, joint);
    assert.ok(Number.isFinite(value) && value >= min && value <= max,
      `${config.form}/${lane.index}/${joint}: ${value} outside [${min},${max}]`);
  }
  if (config.form === 'foot') assert.equal(pose.fingers[0].pip, 0);
}
function assertOnlyJointChanged(before, after, index, joint, label) {
  const restored = clone(after);
  address(restored, index)[joint] = address(before, index)[joint];
  assert.deepEqual(restored, before, label);
}
function engine(config, sampleRate = 24000) {
  const dsp = new HandDSP(sampleRate);
  dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true);
  dsp.setTransport({ time: .371, tremorOffset: .179, playing: true });
  return dsp;
}
function render(dsp, frames = 2048) {
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  for (let frame = 0; frame < frames; frame += 128) {
    dsp.process(channels[0].subarray(frame, frame + 128), channels[1].subarray(frame, frame + 128));
    checkBounds(dsp.config, dsp.pose);
    for (const voice of dsp.targets) for (const value of Object.values(voice)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
    }
  }
  for (const channel of channels) assert.ok(channel.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
  return channels;
}
const energy = channels => channels.reduce((sum, channel) => sum + channel.reduce((total, value) => total + value * value, 0), 0);
const difference = (a, b) => a.reduce((sum, channel, index) => sum + channel.reduce((total, value, frame) => total + (value - b[index][frame]) ** 2, 0), 0);

test('animation lane helpers expose every real digit, wrist/ankle, and foot-shape joint', () => {
  for (const [form, laneCount, jointCount] of [['hand', 6, 23], ['foot', 7, 25]]) {
    const lanes = handAnimationLanes(form), pose = evaluateHandPose(fixture(form), .31);
    assert.equal(lanes.length, laneCount);
    assert.equal(lanes.reduce((sum, lane) => sum + lane.keys.length, 0), jointCount);
    assert.deepEqual(lanes.map(lane => lane.index), Array.from({ length: laneCount }, (_, i) => i));
    for (const lane of lanes) {
      assert.ok(lane.label.length > 0);
      assert.equal(new Set(lane.keys).size, lane.keys.length);
      for (const joint of lane.keys) {
        assert.ok(handJointLabel(form, lane.index, joint));
        const [min, max] = handAnimationBounds(form, lane.index, joint);
        assert.ok(Number.isFinite(min) && Number.isFinite(max) && min < max);
        assert.equal(handAnimationValue(pose, lane.index, joint), address(pose, lane.index)[joint]);
      }
    }
    checkBounds(fixture(form), pose);
  }
  assert.deepEqual(handAnimationLanes('foot')[0].keys, ['mcp', 'dip', 'spread']);
  assert.equal(handJointLabel('foot', 0, 'pip'), '');
});

test('sparse edit helpers own independent bounded arrays and remove only the selected correction', () => {
  const config = fixture(), original = clone(config), supplied = wave();
  setHandAnimationEdit(config, 2, 'pip', supplied);
  assert.notEqual(getHandAnimationEdit(config, 2, 'pip'), supplied);
  supplied[1] = .99;
  assert.notEqual(getHandAnimationEdit(config, 2, 'pip')[1], .99);
  setHandAnimationEdit(config, 5, 'flex', constant(.1));
  const fingerCurve = clone(getHandAnimationEdit(config, 2, 'pip'));
  assert.equal(getHandAnimationEdit(config, 1, 'pip'), undefined);
  setHandAnimationEdit(config, 5, 'flex', null);
  assert.equal(getHandAnimationEdit(config, 5, 'flex'), undefined);
  assert.deepEqual(getHandAnimationEdit(config, 2, 'pip'), fingerCurve);
  setHandAnimationEdit(config, 2, 'pip', null);
  assert.deepEqual(normalizeHandConfig(config), original);
});

test('hostile and neutral edits normalize to sparse finite whitelisted state', () => {
  for (const value of [undefined, null, false, 7, 'bad', [], {}, { fingers: [{ mcp: constant(0) }], wrist: { flex: [] } }]) {
    assert.deepEqual(normalizeHandMotionEdits(value), {});
  }
  const hostile = { fingers: [{ mcp: [NaN, Infinity, -Infinity, Symbol(), 8, -9, '.4'],
    pip: new Float32Array([.2, -.4]), unknown: constant(1) }, null, { dip: Array(500).fill(2) }],
    wrist: { flex: constant(-2), side: 'invalid', noJoint: constant(1) },
    foot: { arch: [1], stretch: [NaN, .2], other: constant(1) }, unknown: constant(1) };
  const normalized = normalizeHandMotionEdits(hostile);
  assert.deepEqual(Object.keys(normalized), ['fingers', 'wrist', 'foot']);
  assert.deepEqual(normalized.fingers[0].mcp.slice(0, 7), [0, 0, 0, 0, 1, -1, .4]);
  assert.deepEqual(Object.keys(normalized.fingers[0]), ['mcp', 'pip']);
  assert.deepEqual(Object.keys(normalized.wrist), ['flex']);
  assert.deepEqual(Object.keys(normalized.foot), ['arch', 'stretch']);
  assert.equal(normalized.fingers.length, 5);
  for (const group of [...normalized.fingers, normalized.wrist, normalized.foot]) for (const curve of Object.values(group)) {
    assert.equal(curve.length, HAND_CONTOUR_POINTS);
    assert.ok(curve.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  }
  const again = normalizeHandMotionEdits(normalized);
  assert.deepEqual(again, normalized);
  again.fingers[0].mcp[0] = .8;
  assert.equal(normalized.fingers[0].mcp[0], 0);
  assert.deepEqual(normalizeHandConfig({ motion: { edits: hostile } }).motion.edits, normalized);
});

test('every exposed joint edits Still at zero movement size, affects sound, and leaves all other joints intact', () => {
  for (const form of ['hand', 'foot']) for (const lane of handAnimationLanes(form)) for (const joint of lane.keys) {
    const config = fixture(form), saved = clone(config), before = evaluateHandPose(config, .731), voicesBefore = evaluateHandVoices(config, .731);
    setHandAnimationEdit(config, lane.index, joint, constant(.075));
    const after = evaluateHandPose(config, .731), voicesAfter = evaluateHandVoices(config, .731);
    const label = `${form}/${lane.index}/${joint}`, [min, max] = handAnimationBounds(form, lane.index, joint);
    close(handAnimationValue(after, lane.index, joint) - handAnimationValue(before, lane.index, joint), .075 * (max - min));
    assertOnlyJointChanged(before, after, lane.index, joint, label);
    assert.equal(config.motion.custom, false, label);
    assert.equal(config.motion.id, 'still', label);
    assert.equal(config.motion.amount, 0, label);
    assert.equal(handMotionPeriod(config.motion), handMotionPeriod(saved.motion), label);
    for (let voice = 0; voice < 5; voice++) {
      if (lane.index >= 5 || voice === lane.index) assert.ok(toneChanged(voicesAfter[voice], voicesBefore[voice]), `${label} voice ${voice}`);
      else assert.deepEqual(voicesAfter[voice], voicesBefore[voice], `${label} unedited voice ${voice}`);
    }
    checkBounds(config, after);
  }
});

test('one edit retains each factory animation, its native period, source metadata, and every unaffected coordinate', () => {
  for (const { id, snapshot } of HAND_PRESETS) {
    const config = clone(snapshot), originalMotion = clone(config.motion);
    setHandAnimationEdit(config, 2, 'pip', wave(.03));
    const { edits, ...motion } = config.motion, { edits: oldEdits, ...oldMotion } = originalMotion;
    assert.deepEqual(motion, oldMotion, id);
    assert.equal(handMotionPeriod(config.motion), handMotionPeriod(snapshot.motion), id);
    const period = handMotionPeriod(snapshot.motion);
    for (const fraction of [.033, .113, .371, .793, 1.237]) {
      const time = fraction * period, tremorTime = time + .179;
      const before = evaluateHandPose(snapshot, time, undefined, tremorTime);
      const after = evaluateHandPose(config, time, undefined, tremorTime);
      assertOnlyJointChanged(before, after, 2, 'pip', `${id}/${fraction}`);
      assert.deepEqual(after.source, before.source, `${id} imported animation`);
      const a = evaluateHandVoices(snapshot, time, undefined, undefined, undefined, tremorTime);
      const b = evaluateHandVoices(config, time, undefined, undefined, undefined, tremorTime);
      for (const finger of [0, 1, 3, 4]) assert.deepEqual(b[finger], a[finger], `${id} unedited voice ${finger}`);
    }
  }
});

test('legacy custom curves survive new wrist and shape corrections without being recaptured', () => {
  for (const form of ['hand', 'foot']) {
    const config = fixture(form); config.motion.custom = true; config.motion.amount = .6;
    config.motion.contours[1].mcp = wave(.2); config.motion.contours[3].spread = wave(.1);
    const saved = clone(config), index = form === 'foot' ? 6 : 5, joint = form === 'foot' ? 'arch' : 'flex';
    setHandAnimationEdit(config, index, joint, wave(.05));
    assert.equal(config.motion.custom, true);
    assert.deepEqual(config.motion.contours, saved.motion.contours);
    assert.equal(handMotionPeriod(config.motion), handMotionPeriod(saved.motion));
    for (const time of [.137, .91, 2.7, 4.81]) {
      assertOnlyJointChanged(evaluateHandPose(saved, time), evaluateHandPose(config, time), index, joint, form);
    }
  }
});

test('small corrections retain the selected joint’s high-frequency tremor waveform', () => {
  for (const form of ['hand', 'foot']) {
    const config = fixture(form);
    config.tremor = { ...config.tremor, finger: 'all', joint: 'whole', amount: 3,
      rate: 99.136733177, rateSpread: .61, phaseSpread: .83 };
    const edited = clone(config); setHandAnimationEdit(edited, 1, 'pip', constant(.02));
    const [min, max] = handAnimationBounds(form, 1, 'pip');
    let travel = 0, previousBefore, previousAfter;
    for (let i = 0; i < 129; i++) {
      const time = .7 + i * .000237, tremorTime = time + .413;
      const a = evaluateHandPose(config, time, undefined, tremorTime), b = evaluateHandPose(edited, time, undefined, tremorTime);
      close(b.fingers[1].pip - a.fingers[1].pip, .02 * (max - min));
      assertOnlyJointChanged(a, b, 1, 'pip', form);
      if (i > 0) {
        close(b.fingers[1].pip - previousAfter, a.fingers[1].pip - previousBefore);
        travel += Math.abs(a.fingers[1].pip - previousBefore);
      }
      previousBefore = a.fingers[1].pip; previousAfter = b.fingers[1].pip;
    }
    assert.ok(travel > 10, `${form}: test exercised fast tremor`);
  }
});

test('missing, zero, and reset corrections restore exact preset poses and sound targets', () => {
  for (const { id, snapshot } of HAND_PRESETS) {
    const missing = clone(snapshot); delete missing.motion.edits;
    const zero = clone(snapshot);
    for (const lane of handAnimationLanes(zero.form)) for (const joint of lane.keys) setHandAnimationEdit(zero, lane.index, joint, constant(0));
    const reset = clone(snapshot); setHandAnimationEdit(reset, 5, 'flex', wave()); setHandAnimationEdit(reset, 5, 'flex', null);
    assert.deepEqual(normalizeHandConfig(reset), snapshot, id);
    assert.deepEqual(normalizeHandConfig(zero), snapshot, id);
    for (const time of [.137, .731, 2.817]) {
      for (const candidate of [missing, zero, reset]) {
        assert.deepEqual(evaluateHandPose(candidate, time), evaluateHandPose(snapshot, time), id);
        assert.deepEqual(evaluateHandVoices(candidate, time), evaluateHandVoices(snapshot, time), id);
      }
    }
  }
});

test('hidden big-toe middle and hand-only-inapplicable foot edits remain inert', () => {
  const foot = fixture('foot'), editedFoot = clone(foot); setHandAnimationEdit(editedFoot, 0, 'pip', constant(1));
  const hand = fixture('hand'), editedHand = clone(hand); setHandAnimationEdit(editedHand, 6, 'arch', constant(1));
  for (const time of [.131, .67, 2.99]) {
    assert.deepEqual(evaluateHandPose(editedFoot, time), evaluateHandPose(foot, time));
    assert.deepEqual(evaluateHandVoices(editedFoot, time), evaluateHandVoices(foot, time));
    assert.deepEqual(evaluateHandPose(editedHand, time), evaluateHandPose(hand, time));
    assert.deepEqual(evaluateHandVoices(editedHand, time), evaluateHandVoices(hand, time));
  }
});

test('JSON round trips and tempo rebasing preserve edits, phase, and tremor reference', () => {
  for (const seed of [38, 69, 103]) {
    const config = randomizeHandConfig(HAND_DEFAULTS, seeded(seed));
    setHandAnimationEdit(config, 1, 'mcp', wave(.04)); setHandAnimationEdit(config, 5, 'twist', wave(.02));
    if (config.form === 'foot') setHandAnimationEdit(config, 6, 'stretch', wave(.04));
    const saved = normalizeHandConfig(config), recalled = normalizeHandConfig(JSON.parse(JSON.stringify(config)));
    assert.deepEqual(recalled, saved);
    const time = .371, offset = .173, before = evaluateHandPose(saved, time, undefined, time + offset);
    for (const bpm of [2, 4400]) {
      const next = clone(recalled); setHandEffectiveTempo(next.motion, bpm);
      const nextTime = time * handMotionPeriod(next.motion) / handMotionPeriod(saved.motion);
      const nextOffset = (time + offset) * handTremorRate(saved) / handTremorRate(next) - nextTime;
      const after = evaluateHandPose(next, nextTime, undefined, nextTime + nextOffset);
      for (const lane of handAnimationLanes(next.form)) for (const joint of lane.keys) {
        close(handAnimationValue(after, lane.index, joint), handAnimationValue(before, lane.index, joint), 1e-7);
      }
      assert.deepEqual(next.motion.edits, saved.motion.edits);
      assert.equal(next.tremor.referenceTempo, saved.tremor.referenceTempo);
      assert.equal(handEffectiveTempo(next.motion), bpm);
    }
  }
});

test('new digit, wrist/ankle, and foot-shape corrections reach real DSP audio', () => {
  for (const form of ['hand', 'foot']) {
    const original = fixture(form), reference = render(engine(original), 4096);
    assert.ok(energy(reference) > .01);
    const cases = [[1, 'pip'], [5, 'flex'], ...(form === 'foot' ? [[6, 'arch'], [6, 'twist'], [6, 'stretch']] : [])];
    for (const [index, joint] of cases) {
      const config = clone(original); setHandAnimationEdit(config, index, joint, constant(.075));
      const actual = render(engine(config), 4096);
      assert.ok(difference(reference, actual) > .001, `${form}/${index}/${joint}: audible signal difference`);
      const reset = clone(config); setHandAnimationEdit(reset, index, joint, null);
      assert.deepEqual(render(engine(reset), 4096), reference, `${form}/${index}/${joint}: exact reset`);
    }
  }
});

test('extreme corrections keep both rigs and all sources finite and bounded through actual DSP', () => {
  const seen = new Set();
  for (const form of ['hand', 'foot']) for (const rate of [8000, 24000, 48000]) for (const [mode, bpm] of [2, 4400].entries()) {
    const config = fixture(form);
    config.motion.id = 'scatter'; config.motion.amount = 1; config.motion.elasticity = 1;
    config.tremor = { ...config.tremor, joint: mode ? 'wrist' : 'whole', amount: 45, rate: 120, rateSpread: 1, phaseSpread: 1, referenceTempo: 2 };
    config.sound.rootHz = mode ? 1600 : 35; config.sound.space = 1; config.sound.rotationFx = 1;
    setHandEffectiveTempo(config.motion, bpm);
    for (let i = 0; i < 5; i++) { config.voices[i].source = VOICE_SOURCES[i + mode * 5]; seen.add(config.voices[i].source); }
    for (const lane of handAnimationLanes(form)) for (const joint of lane.keys) {
      setHandAnimationEdit(config, lane.index, joint, Array.from({ length: HAND_CONTOUR_POINTS }, (_, i) => i % 2 ? 1 : -1));
    }
    const audio = render(engine(config, rate), 2048);
    assert.ok(energy(audio) > 1e-8, `${form}/${rate}/${bpm}: playable output`);
  }
  assert.deepEqual([...seen].sort(), [...VOICE_SOURCES].sort());
});
