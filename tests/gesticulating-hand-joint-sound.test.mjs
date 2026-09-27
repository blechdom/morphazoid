import test from 'node:test';
import assert from 'node:assert/strict';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
import { HAND_PRESETS, VOICE_SOURCES, normalizeHandConfig, evaluateHandPose, evaluateHandVoices,
  handJointKeys, handDigitLimits, handWristLimits, FOOT_LIMITS, handMotionPeriod } from '../src/instruments/gesticulating-hand/hand-model.js';

const copy = structuredClone;
const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const distance = (a, b) => rms(a.map((v, i) => v - b[i]));
function scene(source, form = 'hand', finger = 2) {
  const c = normalizeHandConfig({ form, motion: { id: 'still' }, sound: { space: 0, rotationFx: 0, attack: .004 },
    voices: Array.from({ length: 5 }, (_, i) => ({ source, level: i === finger ? 1 : 0 })) });
  const limits = handDigitLimits(form, finger);
  for (const key of handJointKeys(form, finger)) c.pose.fingers[finger][key] = (limits[key][0] + limits[key][1]) / 2;
  return c;
}
function engine(config, rate = 16000, moving = false) {
  const dsp = new HandDSP(rate); dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true);
  dsp.setTransport({ playing: moving }); return dsp;
}
function render(dsp, seconds = .15) {
  const left = new Float32Array(Math.round(dsp.sampleRate * seconds)), right = new Float32Array(left.length);
  for (let offset = 0; offset < left.length; offset += 128) dsp.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128));
  assert.ok(left.every(v => Number.isFinite(v) && Math.abs(v) < .82));
  assert.ok(right.every(v => Number.isFinite(v) && Math.abs(v) < .82));
  return left.map((v, i) => (v + right[i]) / 2);
}
const targetFields = ['frequency', 'brightness', 'roughness', 'pan', 'excitation'];

test('every factory scene retains sonic response to visible joint, wrist and foot edits over its cycle', () => {
  for (const preset of HAND_PRESETS) {
    const c = preset.snapshot, period = handMotionPeriod(c.motion), controls = [];
    for (let i = 0; i < 5; i++) for (const key of handJointKeys(c.form, i)) controls.push({
      name: `${i}/${key}`, min: handDigitLimits(c.form, i)[key][0], max: handDigitLimits(c.form, i)[key][1],
      read: pose => pose.fingers[i][key], edit: (config, value) => { config.pose.fingers[i][key] = value; }, affected: [i],
    });
    for (const [part, limits] of [['wrist', handWristLimits(c.form)], ...(c.form === 'foot' ? [['foot', FOOT_LIMITS.shape]] : [])]) {
      for (const [key, [min, max]] of Object.entries(limits)) controls.push({name: `${part}/${key}`, min, max,
        read: pose => pose[part][key], edit: (config, value) => { config.pose[part][key] = value; }, affected: [0, 1, 2, 3, 4] });
    }
    for (const control of controls) {
      let responds = false;
      for (const direction of [-1, 1]) {
        const changed = copy(c), value = Math.max(control.min, Math.min(control.max, control.read(c.pose) + direction * (control.max - control.min) * .05));
        if (value === control.read(c.pose)) continue;
        control.edit(changed, value);
        for (let phase = 0; phase < 24; phase++) {
          const at = (phase + .37) / 24 * period;
          if (Math.abs(control.read(evaluateHandPose(c, at)) - control.read(evaluateHandPose(changed, at))) < 1e-8) continue;
          const before = evaluateHandVoices(c, at), after = evaluateHandVoices(changed, at);
          assert.ok(control.affected.some(i => targetFields.some(key => Math.abs(before[i][key] - after[i][key]) > 1e-8)), `${preset.label} ${control.name}: visible edit lost in audio mapping`);
          responds = true;
        }
      }
      assert.ok(responds, `${preset.label} ${control.name}: base edit pinned for a whole cycle`);
    }
  }
});

test('each physical finger and toe joint changes rendered mono audio in all ten engines', () => {
  for (const source of VOICE_SOURCES) for (const form of ['hand', 'foot']) for (let finger = 0; finger < 5; finger++) {
    const config = scene(source, form, finger), baseline = render(engine(config));
    for (const key of handJointKeys(form, finger)) {
      const changed = copy(config), [min, max] = handDigitLimits(form, finger)[key];
      changed.pose.fingers[finger][key] += (max - min) * .2;
      const signal = render(engine(changed));
      assert.ok(distance(baseline, signal) > rms(baseline) * .01, `${source}/${form}/${finger}/${key}`);
    }
  }
});

test('splay changes mono timbre in both directions, and high register bends work at 8 kHz', () => {
  for (const source of VOICE_SOURCES) {
    const negative = scene(source), positive = copy(negative);
    negative.pose.fingers[2].spread = -25; positive.pose.fingers[2].spread = 25;
    const a = render(engine(negative)), b = render(engine(positive));
    const matchedA = a.map(v => v / rms(a)), matchedB = b.map(v => v / rms(b));
    assert.ok(distance(matchedA, matchedB) > .01, `${source}: spread must change more than mono gain`);
    const high = scene(source); high.sound.rootHz = 1600; high.sound.brightness = 1;
    high.pose.fingers[2].mcp = 70;
    const base = render(engine(high, 8000));
    for (const key of ['mcp', 'pip', 'dip']) {
      const changed = copy(high); changed.pose.fingers[2][key] += 10;
      assert.ok(distance(base, render(engine(changed, 8000))) > rms(base) * .01, `${source}: high ${key} plateau`);
    }
  }
});

test('spread and wrist travel excite mallets and fast tremor has no 100 Hz blind spot', () => {
  for (const source of ['metal', 'marimba']) for (const joint of ['spread', 'wrist', 'tip']) {
    for (const rate of joint === 'tip' ? [90, 99, 100, 101, 110, 120] : [7]) {
      const config = scene(source); config.tremor = { finger: 'middle', joint, amount: 12, rate };
      const dsp = engine(config, 16000, true);
      render(dsp, 2); assert.ok(rms(render(dsp, .3)) > .002, `${source}/${joint}/${rate} Hz lost movement excitation`);
      dsp.setTransport({ playing: false });
      const tail = rms(render(dsp, .2)); render(dsp, 4);
      assert.equal(dsp.targets[2].excitation, 0);
      assert.ok(rms(render(dsp, .1)) < tail * .025, `${source}: paused movement must decay without fresh strikes`);
    }
  }
});

test('Neon tap and Tin Morse permit local edits in both directions without changing motion', () => {
  for (const [id, finger, key] of [['hand-tin-morse', 4, 'spread'], ['foot-neon-tap', 2, 'mcp'], ['foot-neon-tap', 3, 'mcp'], ['foot-neon-tap', 4, 'mcp']]) {
    const base = HAND_PRESETS.find(p => p.id === id).snapshot;
    for (const direction of [-1, 1]) {
      const changed = copy(base); changed.pose.fingers[finger][key] += direction * 4;
      assert.deepEqual(changed.motion, base.motion);
      assert.ok(Array.from({length:32}, (_, n) => n / 32 * handMotionPeriod(base.motion)).some(at =>
        evaluateHandPose(base, at).fingers[finger][key] !== evaluateHandPose(changed, at).fingers[finger][key]), `${id}/${finger}/${direction}`);
    }
  }
});
