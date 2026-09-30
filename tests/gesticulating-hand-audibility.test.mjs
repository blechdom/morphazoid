import test from 'node:test';
import assert from 'node:assert/strict';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
import { HandOutput, HAND_OUTPUT_CEILING } from '../src/instruments/gesticulating-hand/hand-output.js';
import { HAND_PRESETS, VOICE_SOURCES, normalizeHandConfig, randomizeHandConfig, handEffectiveTempo, handMotionPeriod } from '../src/instruments/gesticulating-hand/hand-model.js';
import { HAND_RHYTHMS, handRhythmPhase, handRhythmTiming } from '../src/instruments/gesticulating-hand/hand-rhythm.js';

const seeded = initial => { let seed = initial; return () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32; };
const rms = a => Math.sqrt(a.reduce((sum, value) => sum + value * value, 0) / a.length);
const peak = a => a.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
function engine(config, { playing = false, phase = 0, rate = 12000 } = {}) {
  const dsp = new HandDSP(rate); dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(playing);
  dsp.setTransport({ time: handMotionPeriod(config.motion) * phase, playing });
  return dsp;
}
function render(dsp, seconds, output = new HandOutput(dsp.sampleRate)) {
  const left = new Float32Array(Math.round(seconds * dsp.sampleRate)), right = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 128) {
    const l = left.subarray(i, i + 128), r = right.subarray(i, i + 128);
    dsp.process(l, r); output.process(l, r);
  }
  // The page's default master comes AFTER the instrument's gain and limiter.
  return { left: left.map(value => value * .4), right: right.map(value => value * .4) };
}
function previewScene(source = 'wire') {
  return normalizeHandConfig({ motion: { id: 'still' }, sound: { attack: 1.2, space: 0, rotationFx: 0, rhythm: 'broken' },
    voices: Array.from({ length: 5 }, () => ({ source, level: .7, attackScale: 4 })) });
}

test('phrase rest analysis agrees with independent sampled gates, including solo voices and wraparound', () => {
  for (const { id } of HAND_RHYTHMS.filter(rhythm => rhythm.id !== 'continuous')) for (const mask of [1, 2, 4, 8, 16, 5, 18, 31]) {
    const period = id === 'walk' ? 5 : 4, steps = 8000, step = period / steps, length = .37;
    let rest = 0, longest = 0;
    // Two periods expose the rest spanning the phrase boundary.
    for (let j = 0; j < steps * 2; j++) {
      const beat = (j + .5) * step;
      const on = Array.from({ length: 5 }, (_, i) => {
        const phase = handRhythmPhase(id, beat, i);
        return (mask & 1 << i) && phase >= 0 && phase < length;
      }).some(Boolean);
      rest = on ? 0 : rest + step; longest = Math.max(longest, rest);
    }
    assert.ok(Math.abs(handRhythmTiming(id, length, mask).longestRest - longest) < step * 2, `${id}/${mask}`);
  }
});

test('dice keeps broad musical variation with audible partners and attacks that fit the score', () => {
  const rhythms = new Set(), sources = new Set(), tempos = [], attacks = new Set(); let muted = false, solo = false;
  for (let i = 1; i <= 256; i++) {
    const config = randomizeHandConfig(undefined, seeded(Math.imul(i, 0x9e3779b1) >>> 0));
    const hasSolo = config.voices.some(v => v.solo && !v.mute);
    const active = config.voices.filter(v => !v.mute && (!hasSolo || v.solo));
    assert.ok(active.length >= 2); assert.ok(active.every(v => v.level >= .6));
    assert.ok(active.some(v => !['metal', 'marimba'].includes(v.source)));
    for (const voice of active) {
      assert.ok(config.sound.attack * voice.attackScale <= .25 + 1e-12);
      sources.add(voice.source);
    }
    const secondsPerBeat = 60 / handEffectiveTempo(config.motion);
    const mask = config.voices.reduce((mask, v, index) => active.includes(v) ? mask | 1 << index : mask, 0);
    const timing = handRhythmTiming(config.sound.rhythm, config.sound.noteLength, mask);
    assert.ok(timing.longestRest * secondsPerBeat <= .75 + 1e-12);
    for (const voice of active) assert.ok(config.sound.attack * voice.attackScale <= timing.shortestNote * secondsPerBeat * .5 + 1e-12);
    rhythms.add(config.sound.rhythm); tempos.push(handEffectiveTempo(config.motion)); attacks.add(config.sound.attack);
    muted ||= config.voices.some(v => v.mute); solo ||= hasSolo;
  }
  assert.equal(rhythms.size, HAND_RHYTHMS.length); assert.equal(sources.size, VOICE_SOURCES.length);
  assert.ok(muted && solo && attacks.size > 100);
  assert.ok(Math.min(...tempos) < 10 && Math.max(...tempos) > 3000, 'slow and frantic gestures remain available');
});

test('formerly silent and suppressed dice seeds produce ongoing output at the real output gain', () => {
  for (const [seed, phase] of [[72, .823], [74, .173], [79, .5], [4203543429, 0], [1697034193, .5]]) {
    const config = randomizeHandConfig(undefined, seeded(seed));
    const dsp = engine(config, { playing: true, phase, rate: 48000 });
    const { left, right } = render(dsp, 1.5);
    for (const samples of [left, right]) {
      assert.ok(samples.every(Number.isFinite)); assert.ok(peak(samples) <= HAND_OUTPUT_CEILING * .4 + 1e-7);
    }
    assert.ok(Math.hypot(rms(left), rms(right)) > .004, `${seed}: audible without any preview`);
    assert.ok(Math.hypot(rms(left.subarray(24000)), rms(right.subarray(24000))) > .004, `${seed}: stays audible`);
  }
});

test('preset preview speaks promptly through long attacks and rests without changing transport or the saved envelope', () => {
  for (const source of VOICE_SOURCES) {
    const dsp = engine(previewScene(source)), clock = dsp.getMotionTime(), config = structuredClone(dsp.config);
    assert.equal(dsp.previewPreset(), true);
    const { left, right } = render(dsp, .1);
    assert.ok(Math.hypot(rms(left), rms(right)) > .002, source);
    assert.equal(dsp.getMotionTime(), clock); assert.equal(dsp.playing, false); assert.equal(dsp.soundPlaying, false);
    assert.deepEqual(dsp.config, config); assert.ok(dsp.voices.every(v => v.envelope === 0));
    render(dsp, 1.3); assert.ok(peak(render(dsp, .1).left) < 1e-7, source);
  }
});

test('preview honors mute, solo and zero levels; no hidden note appears when excluded voices are enabled later', () => {
  const config = previewScene();
  config.voices[0].solo = true; config.voices[1].solo = true; config.voices[1].mute = true;
  config.voices[2].level = 0; config.voices[2].solo = true;
  const dsp = engine(config); dsp.previewPreset(); render(dsp, .04);
  assert.ok(dsp.voiceLevels[0] > .1);
  for (const i of [1, 2, 3, 4]) assert.equal(dsp.voiceLevels[i], 0);
  config.voices.forEach(v => { v.mute = false; v.solo = false; v.level = .7; });
  dsp.setConfig(config); render(dsp, .04);
  for (const i of [1, 2, 3, 4]) assert.equal(dsp.voiceLevels[i], 0);
  config.voices.forEach(v => { v.mute = true; }); dsp.setConfig(config);
  assert.equal(dsp.previewPreset(), false);
});

test('Audio off, Sound stop and reset cancel previews; repeated percussion selections retrigger', () => {
  for (const cancel of [dsp => dsp.setEnabled(false), dsp => dsp.setSoundPlaying(false), dsp => dsp.reset()]) {
    const dsp = engine(previewScene()); dsp.previewPreset(); render(dsp, .02); cancel(dsp);
    render(dsp, .25); dsp.setEnabled(true);
    assert.ok(peak(render(dsp, .1).left) < 1e-7);
    assert.equal(dsp.soundPlaying, false);
  }
  const off = engine(previewScene()); off.setEnabled(false);
  assert.equal(off.previewPreset(), false); assert.equal(peak(render(off, .1).left), 0);
  for (const source of ['metal', 'marimba']) {
    const dsp = engine(previewScene(source)); dsp.previewPreset(.1); render(dsp, .6);
    assert.equal(dsp.previewPreset(.1), true);
    assert.ok(rms(render(dsp, .08).left) > .004, source);
  }
});

test('the quieter rhythmic factory scenes retain rests but reach a stronger measured level', () => {
  for (const id of ['hand-wire-backbeat', 'hand-tin-skips', 'foot-copper-breaks']) {
    const config = HAND_PRESETS.find(preset => preset.id === id).snapshot;
    const { left, right } = render(engine(config, { playing: true, phase: .371, rate: 48000 }), 1);
    const stereoRms = Math.hypot(rms(left), rms(right)) / Math.SQRT2;
    assert.ok(stereoRms > .016, `${id}: ${stereoRms}`);
    assert.notEqual(config.sound.rhythm, 'continuous'); assert.ok(config.sound.noteLength <= .3);
  }
});


test('preview does not stack gain on an already sounding voice or rewrite its normal envelope', () => {
  const config = previewScene(); config.sound.rhythm = 'continuous'; config.sound.attack = .004;
  const reference = engine(config, { playing: true }), previewed = engine(config, { playing: true });
  render(reference, .2); render(previewed, .2); previewed.previewPreset();
  assert.deepEqual(render(previewed, .1), render(reference, .1));
  config.sound.attack = 1.2;
  const slow = engine(config, { playing: true }), heard = engine(config, { playing: true });
  heard.previewPreset(); render(slow, .2); render(heard, .2);
  assert.deepEqual(heard.voices.map(v => v.envelope), slow.voices.map(v => v.envelope));
});
