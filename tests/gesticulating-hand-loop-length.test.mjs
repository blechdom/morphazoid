import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
import { HandAudio } from '../src/instruments/gesticulating-hand/hand-audio.js';
import {
  HAND_DEFAULTS, HAND_MOTIONS, HAND_PRESETS, VOICE_SOURCES,
  normalizeHandConfig, randomizeHandConfig, handPoseForForm,
  handMotionBeats, handLoopBeats, handMotionPeriod, setHandEffectiveTempo,
  setHandAnimationEdit, captureHandContours, evaluateHandPose, evaluateHandVoices,
} from '../src/instruments/gesticulating-hand/hand-model.js';

const clone = value => structuredClone(value);
const seeded = initial => {
  let seed = initial;
  return () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32;
};
const wave = (depth = .05, phase = 0) => Array.from({ length: 16 }, (_, i) => depth * Math.sin(i * Math.PI / 8 + phase));
const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const poseValues = pose => [...pose.fingers.flatMap(f => Object.values(f)), ...Object.values(pose.wrist), ...Object.values(pose.foot ?? {})];
function closePose(actual, expected, tolerance = 1e-8) {
  const a = poseValues(actual), b = poseValues(expected);
  assert.equal(a.length, b.length);
  a.forEach((value, i) => close(value, b[i], tolerance));
  assert.equal(Boolean(actual.source), Boolean(expected.source));
  if (actual.source) {
    close(actual.source.phase, expected.source.phase, tolerance);
    close(actual.source.amount, expected.source.amount, tolerance);
    actual.source.offsets.forEach((finger, i) => {
      for (const key of Object.keys(finger)) close(finger[key], expected.source.offsets[i][key], tolerance);
    });
  }
}
function scene(form = 'hand', id = 'wave') {
  return normalizeHandConfig({ form, pose: handPoseForForm('relaxed', form),
    motion: { id, tempo: 120, speed: 1, amount: .65, elasticity: form === 'foot' ? .37 : 0 },
    tremor: { amount: 0 }, sound: { rhythm: 'continuous', rootHz: 181, space: 0, rotationFx: 0, attack: .004, release: .04 },
    voices: Array.from({ length: 5 }, () => ({ source: 'wire', level: .65 })) });
}
function engine(config, rate = 12000, transport = {}) {
  const dsp = new HandDSP(rate);
  dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true);
  dsp.setTransport({ time: .173, playing: true, ...transport });
  return dsp;
}
function render(dsp, frames = 1536, chunk = 128) {
  const channels = [new Float32Array(frames), new Float32Array(frames)], start = dsp.clock;
  for (let offset = 0; offset < frames; offset += chunk) {
    dsp.process(channels[0].subarray(offset, offset + chunk), channels[1].subarray(offset, offset + chunk), start + offset / dsp.sampleRate);
  }
  return channels;
}
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

test('missing and malformed loop lengths follow native choreography; numeric overrides round and clamp', () => {
  assert.equal(HAND_DEFAULTS.motion.loopBeats, null);
  assert.equal(normalizeHandConfig().motion.loopBeats, null);
  for (const loopBeats of [undefined, null, NaN, Infinity, -Infinity, true, false, [], {}, Symbol(), 8n, '', '  ', 'invalid', '2'.repeat(80)]) {
    const config = normalizeHandConfig({ motion: { id: 'count', loopBeats } });
    assert.equal(config.motion.loopBeats, null);
    assert.equal(handLoopBeats(config.motion), 10);
    assert.equal(handLoopBeats({ id: 'count', loopBeats }), 10);
  }
  for (const [value, expected] of [[-20, 1], [0, 1], [1.49, 1], [1.5, 2], [6.6, 7], [' 7.5 ', 8], ['0x10', 16], ['1e2', 64], [1000, 64]]) {
    assert.equal(normalizeHandConfig({ motion: { loopBeats: value } }).motion.loopBeats, expected);
    assert.equal(handLoopBeats({ loopBeats: value }), expected);
  }
  assert.equal(handLoopBeats(null), 4);
  assert.equal(handLoopBeats({ id: 'unknown' }), 4);
  assert.equal(handLoopBeats({ id: 'count', custom: true }), 4);
});

test('every factory preset retains its native period and explicit lengths share the existing tempo range', () => {
  for (const { id, snapshot } of HAND_PRESETS) {
    assert.equal(snapshot.motion.loopBeats, null, id);
    const native = snapshot.motion.custom ? 4 : handMotionBeats(snapshot.motion.id);
    assert.equal(handLoopBeats(snapshot.motion), native, id);
    close(handMotionPeriod(snapshot.motion), native * 60 / (snapshot.motion.tempo * snapshot.motion.speed));
  }
  for (const length of [1, 7, 64]) for (const tempo of [2, 73.5, 4400]) {
    const motion = { id: 'count', loopBeats: length };
    setHandEffectiveTempo(motion, tempo);
    close(handMotionPeriod(motion), length * 60 / tempo);
  }
});

test('every hand and foot animation retains its trajectory when the full loop is stretched', () => {
  for (const form of ['hand', 'foot']) for (const { id, beats } of HAND_MOTIONS) {
    const original = scene(form, id);
    original.tremor.amount = 4; original.tremor.rate = 3.7; original.sound.rhythm = 'broken';
    for (const loopBeats of [1, 7, 64]) {
      const retimed = clone(original); retimed.motion.loopBeats = loopBeats;
      for (const fraction of [.037, .241, .517, .887, 2.371]) {
        // Tremor and written notes remain at the same real-time instant.
        const before = evaluateHandPose(original, fraction * beats / 2, undefined, .319, .031);
        const after = evaluateHandPose(retimed, fraction * loopBeats / 2, undefined, .319, .031);
        closePose(after, before);
      }
    }
  }
});

test('Count, drawn curves and sparse digit/wrist/foot edits retain their full phrase and closed seam', () => {
  for (const form of ['hand', 'foot']) for (const custom of [false, true]) {
    const original = scene(form, 'count'); original.motion.custom = custom;
    for (let i = 0; i < 5; i++) for (const key of ['mcp', 'pip', 'dip', 'spread']) original.motion.contours[i][key] = wave(.08, i * .3);
    setHandAnimationEdit(original, 2, 'pip', wave(.06));
    setHandAnimationEdit(original, 5, 'flex', wave(.03, .5));
    if (form === 'foot') {
      setHandAnimationEdit(original, 6, 'arch', wave(.04));
      setHandAnimationEdit(original, 6, 'stretch', wave(.03, .7));
    }
    const saved = clone(original), nativePeriod = custom ? 2 : 5;
    for (const loopBeats of [1, 3, 64]) {
      const retimed = clone(original); retimed.motion.loopBeats = loopBeats;
      const period = loopBeats / 2;
      for (let step = 0; step < 40; step++) {
        const fraction = (step + .2) / 40;
        closePose(evaluateHandPose(retimed, fraction * period), evaluateHandPose(original, fraction * nativePeriod));
      }
      closePose(evaluateHandPose(retimed, period * (1 - 1e-8)), evaluateHandPose(retimed, period * 1e-8), 1e-4);
      const captured = captureHandContours(retimed), expected = captureHandContours(original);
      captured.forEach((finger, i) => {
        for (const key of Object.keys(finger)) finger[key].forEach((value, point) => close(value, expected[i][key][point]));
      });
    }
    assert.deepEqual(original, saved);
  }
});

test('explicit native, null and absent lengths produce identical poses, voice targets and stereo samples', () => {
  const custom = scene(); custom.motion.custom = true; custom.motion.contours[2].mcp = wave(.15);
  for (const snapshot of [...HAND_PRESETS.map(preset => preset.snapshot), custom]) {
    const missing = clone(snapshot), explicit = clone(snapshot), nullable = clone(snapshot);
    delete missing.motion.loopBeats; nullable.motion.loopBeats = null;
    explicit.motion.loopBeats = snapshot.motion.custom ? 4 : handMotionBeats(snapshot.motion.id);
    for (const config of [nullable, explicit]) {
      assert.deepEqual(evaluateHandPose(config, .731), evaluateHandPose(missing, .731));
      assert.deepEqual(evaluateHandVoices(config, .731), evaluateHandVoices(missing, .731));
      assert.deepEqual(render(engine(config)), render(engine(missing)));
    }
  }
});

test('saved overrides survive id/custom changes while null continues to follow the selected choreography', () => {
  for (const override of [null, 13]) {
    let config = scene(); config.motion.loopBeats = override;
    setHandAnimationEdit(config, 1, 'dip', wave(.12));
    for (const [id, custom, native] of [['count', false, 10], ['count', true, 4], ['puppet-mouth', false, 2]]) {
      config.motion.id = id; config.motion.custom = custom;
      const loaded = normalizeHandConfig(JSON.parse(JSON.stringify(config)));
      assert.deepEqual(loaded, config);
      assert.equal(handLoopBeats(loaded.motion), override ?? native);
      assert.deepEqual(evaluateHandPose(loaded, .671), evaluateHandPose(config, .671));
      assert.deepEqual(evaluateHandVoices(loaded, .671), evaluateHandVoices(config, .671));
      config = loaded;
    }
  }
});

function compareScene(actual, expected, path = 'scene') {
  if (typeof expected === 'number') {
    assert.ok(Number.isFinite(actual), `${path}: finite number`);
    if (Number.isInteger(expected)) assert.equal(actual, expected, path);
    else {
      // Pow/sin may differ by a few ULPs across supported Node versions/CPUs.
      const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs(expected));
      assert.ok(Math.abs(actual - expected) <= tolerance, `${path}: ${actual} != ${expected}`);
    }
  } else if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', path);
    assert.equal(Array.isArray(actual), Array.isArray(expected), path);
    if (Array.isArray(expected)) assert.equal(actual.length, expected.length, path);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path}: fields`);
    for (const key of Object.keys(expected)) compareScene(actual[key], expected[key], `${path}.${key}`);
  } else assert.equal(actual, expected, path);
}
test('random loop lengths cover the range without changing any previously seeded scene field', () => {
  // Recorded from f7ab236 before adding loopBeats; compare every original field.
  const { cases: baselines } = JSON.parse(readFileSync(new URL('./fixtures/gesticulating-hand-seeded-scenes.json', import.meta.url), 'utf8'));
  for (const { seed, config: expected } of baselines) {
    const config = randomizeHandConfig(undefined, seeded(seed));
    delete config.motion.loopBeats;
    compareScene(config, expected, `seed ${seed}`);
  }
  const lengths = new Set();
  for (let seed = 1; seed <= 512; seed++) {
    const config = randomizeHandConfig(undefined, seeded(seed));
    assert.ok(Number.isInteger(config.motion.loopBeats));
    assert.ok(config.motion.loopBeats >= 1 && config.motion.loopBeats <= 64);
    lengths.add(config.motion.loopBeats);
  }
  assert.deepEqual([...lengths].sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i + 1));
});

test('visible rhythm taps and their voice excitation use their own current and previous clock samples', () => {
  for (const form of ['hand', 'foot']) {
    const config = scene(form, 'still'); config.motion.elasticity = 0; config.sound.rhythm = 'walk'; config.sound.noteLength = .4;
    const reference = evaluateHandPose(config, .04);
    assert.ok(reference.fingers[0].mcp > config.pose.fingers[0].mcp + 1);
    const voices = evaluateHandVoices(config, .04);
    assert.ok(voices[0].excitation > .001);
    for (const loopBeats of [1, 64]) {
      config.motion.loopBeats = loopBeats;
      assert.deepEqual(evaluateHandPose(config, 10, undefined, 0, .04), reference);
      assert.deepEqual(evaluateHandVoices(config, 10, undefined, undefined, undefined, 0, .04), voices);
      const rest = evaluateHandPose(config, 10, undefined, 0, 2.375);
      assert.equal(rest.fingers[0].mcp, config.pose.fingers[0].mcp);
    }
  }
});

test('DSP rhythm offsets preserve audible gates and visible taps across pause and invalid transport updates', () => {
  for (const form of ['hand', 'foot']) {
    const config = scene(form, 'still'); config.motion.elasticity = 0; config.motion.loopBeats = 64;
    config.sound.rhythm = 'walk'; config.sound.noteLength = .4;
    const dsp = engine(config, 12000, { time: 2.375, playing: false });
    assert.equal(dsp.rhythmOffset, 0);
    render(dsp, 1); assert.ok(dsp.voices.every(voice => !voice.gated));
    dsp.setTransport({ rhythmOffset: -2.3125 }); dsp.updateTargets(dsp.clock);
    const audible = render(dsp, 1800);
    assert.ok(rms(audible[0]) > .001);
    assert.deepEqual(dsp.voices.map(voice => voice.gated), [true, false, false, false, false]);
    closePose(dsp.pose, evaluateHandPose(config, 2.375, undefined, 2.375, .0625));
    for (const rhythmOffset of [undefined, null, NaN, Infinity, -Infinity, {}, [], false, Symbol()]) {
      dsp.setTransport({ rhythmOffset });
      assert.equal(dsp.rhythmOffset, -2.3125);
      assert.equal(dsp.getMotionTime(), 2.375);
    }
    dsp.setTransport({ playing: true }); render(dsp, 1800);
    assert.ok(dsp.getMotionTime() > 2.5);
    assert.ok(dsp.voices.every(voice => !voice.gated));
  }
});

test('wrapper transport can rebase a live loop without moving tremor or rhythm phases or changing playback flags', () => {
  const clock = { now: 1000 }, sent = [];
  const audio = new HandAudio({ performance: { now: () => clock.now } });
  assert.equal(audio.getState().rhythmOffset, 0); assert.equal(audio.getState().rhythmTime, 0);
  audio.node = { port: { postMessage: message => sent.push(message) } };
  const before = scene(); before.sound.rhythm = 'walk'; before.tremor.amount = 5;
  audio.setConfig(before); audio.setSoundPlaying(true); audio.setHeldFingers(4);
  audio.setTransport({ time: .3125, playing: true, tremorOffset: .125, rhythmOffset: .5 });
  clock.now += 375;
  const oldState = audio.getState(), after = clone(before); after.motion.loopBeats = 11;
  const rebased = oldState.time * handMotionPeriod(after.motion) / handMotionPeriod(before.motion);
  const pose = evaluateHandPose(before, oldState.time, undefined, oldState.tremorTime, oldState.rhythmTime);
  audio.setConfig(after);
  audio.setTransport({ time: rebased, tremorOffset: oldState.tremorTime - rebased, rhythmOffset: oldState.rhythmTime - rebased });
  const state = audio.getState();
  close(state.tremorTime, oldState.tremorTime); close(state.rhythmTime, oldState.rhythmTime);
  closePose(evaluateHandPose(after, state.time, undefined, state.tremorTime, state.rhythmTime), pose);
  assert.equal(state.playing, true); assert.equal(state.soundPlaying, true); assert.equal(state.heldFingers, 4); assert.equal(state.armed, false);
  for (const rhythmOffset of [undefined, null, NaN, Infinity, Symbol()]) {
    audio.setTransport({ rhythmOffset });
    assert.equal(audio.getState().rhythmOffset, state.rhythmOffset);
    assert.equal(sent.at(-1).transport.rhythmOffset, state.rhythmOffset);
  }
  clock.now += 250; close(audio.getState().rhythmTime, state.rhythmTime + .25);
  audio.setTransport({ playing: false }); const paused = audio.getState();
  clock.now += 1000; assert.equal(audio.getState().rhythmTime, paused.rhythmTime);
});

test('faster loops increase real-time excitation while preserving timbre at the same trajectory position', () => {
  for (const form of ['hand', 'foot']) {
    const fast = scene(form); fast.motion.loopBeats = 1; fast.motion.amount = .08; fast.motion.elasticity = 0;
    const slow = clone(fast); slow.motion.loopBeats = 64;
    const a = evaluateHandVoices(fast, handMotionPeriod(fast.motion) * .137);
    const b = evaluateHandVoices(slow, handMotionPeriod(slow.motion) * .137);
    const fastTravel = a.reduce((sum, voice) => sum + voice.excitation, 0), slowTravel = b.reduce((sum, voice) => sum + voice.excitation, 0);
    assert.ok(slowTravel > 0); assert.ok(fastTravel > slowTravel * 20);
    for (let i = 0; i < 5; i++) for (const key of ['frequency', 'brightness', 'roughness', 'pan']) close(a[i][key], b[i][key]);
  }
});

test('extreme loop lengths and tempos keep every engine finite, bounded and audible', () => {
  for (const rate of [8000, 48000]) for (const [loopBeats, tempo] of [[1, 4400], [64, 2]]) for (const source of VOICE_SOURCES) {
    const config = scene('foot', 'frantic-orbit'); config.motion.loopBeats = loopBeats; config.motion.elasticity = 1;
    setHandEffectiveTempo(config.motion, tempo);
    config.voices.forEach(voice => { voice.source = source; });
    const channels = render(engine(config, rate), Math.round(rate * .15), 127);
    for (const channel of channels) assert.ok(channel.every(value => Number.isFinite(value) && Math.abs(value) < .82), `${source}/${loopBeats}/${rate}`);
    assert.ok(channels.some(channel => rms(channel) > .0001), `${source}/${loopBeats}/${rate}: audible`);
  }
});

test('retimed motion with a separate rhythm clock is independent of audio block partitioning', () => {
  const config = scene('foot', 'count'); config.motion.loopBeats = 7; config.sound.rhythm = 'broken'; config.tremor.amount = 4;
  const transport = { time: 1.375, rhythmOffset: -1.3125, tremorOffset: .25 };
  const reference = render(engine(config, 8000, transport), 4097);
  for (const chunk of [1, 7, 31, 257, 4097]) assert.deepEqual(render(engine(config, 8000, transport), 4097, chunk), reference);
});
