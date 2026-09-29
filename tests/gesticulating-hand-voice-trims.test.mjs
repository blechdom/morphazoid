import test from 'node:test';
import assert from 'node:assert/strict';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
import {
  HAND_DEFAULTS, HAND_PRESETS, HAND_VOICE_DEFAULTS, HAND_VOICE_LIMITS, VOICE_SOURCES,
  FOOT_LIMITS, normalizeHandConfig, randomizeHandConfig, evaluateHandPose,
  evaluateHandVoices, handJointKeys, handDigitLimits, handWristLimits,
} from '../src/instruments/gesticulating-hand/hand-model.js';

const DEFAULTS = { pitch: 0, tone: 0, grain: 0, pan: 0, attackScale: 1, releaseScale: 1 };
const LIMITS = { pitch: [-2, 2], tone: [-1, 1], grain: [-1, 1], pan: [-1, 1], attackScale: [.25, 4], releaseScale: [.25, 4] };
const KEYS = Object.keys(DEFAULTS), MIDDLE = 2, RATE = 16000;
const TARGETS = ['frequency', 'brightness', 'roughness', 'pan', 'level', 'source', 'excitation'];
const clone = structuredClone;
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const peak = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const difference = (a, b) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

function scene(source = 'glass', form = 'hand') {
  return normalizeHandConfig({
    form, motion: { id: 'still', amount: 0 },
    pose: { fingers: Array.from({ length: 5 }, () => ({ mcp: 15, pip: 20, dip: 12, spread: 0 })) },
    sound: { rootHz: 180, brightness: .5, roughness: .3, space: 0, rotationFx: 0, attack: .008, release: .12 },
    voices: Array.from({ length: 5 }, (_, i) => ({ source: i === MIDDLE ? source : 'glass', level: i === MIDDLE ? 1 : 0 })),
  });
}

function engine(config, rate = RATE, playing = false) {
  const dsp = new HandDSP(rate);
  dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true);
  dsp.setTransport({ time: .137, playing });
  return dsp;
}

function renderFrames(dsp, frames, block = 128) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let start = 0; start < frames; start += block) {
    dsp.process(left.subarray(start, start + block), right.subarray(start, start + block));
  }
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite), 'finite stereo output');
  assert.ok(peak(left) <= .820001 && peak(right) <= .820001, 'stereo output stays bounded');
  return { left, right };
}
const render = (dsp, seconds = .18) => renderFrames(dsp, Math.round(seconds * dsp.sampleRate));
const mono = signal => signal.left.map((value, i) => (value + signal.right[i]) / 2);
const normalized = values => { const level = rms(values); assert.ok(level > 1e-6, 'audible comparison fixture'); return values.map(value => value / level); };
function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

test('voice trims normalize missing, hostile, numeric-string and out-of-range input with neutral defaults', () => {
  assert.deepEqual(HAND_VOICE_DEFAULTS, DEFAULTS);
  assert.deepEqual(HAND_VOICE_LIMITS, LIMITS);
  for (const voice of HAND_DEFAULTS.voices) for (const key of KEYS) assert.equal(voice[key], DEFAULTS[key]);
  for (const [key, [minimum, maximum]] of Object.entries(LIMITS)) {
    for (const value of [undefined, null, NaN, Infinity, -Infinity, Symbol(), {}, []]) {
      assert.equal(normalizeHandConfig({ voices: [{ [key]: value }] }).voices[0][key], DEFAULTS[key], key);
    }
    assert.equal(normalizeHandConfig({ voices: [{ [key]: minimum - 20 }] }).voices[0][key], minimum);
    assert.equal(normalizeHandConfig({ voices: [{ [key]: maximum + 20 }] }).voices[0][key], maximum);
    const value = minimum + (maximum - minimum) * .37;
    assert.equal(normalizeHandConfig({ voices: [{ [key]: String(value) }] }).voices[0][key], value);
  }
  const untouched = scene(), original = clone(untouched);
  normalizeHandConfig(untouched);
  assert.deepEqual(untouched, original, 'normalization must not mutate a captured preset');
});

test('legacy and explicit-neutral voices preserve complete presets, pose targets and rendered sound', () => {
  for (const preset of HAND_PRESETS) {
    const legacy = clone(preset.snapshot);
    for (const voice of legacy.voices) for (const key of KEYS) delete voice[key];
    const explicit = clone(legacy);
    for (const voice of explicit.voices) Object.assign(voice, DEFAULTS);
    assert.deepEqual(normalizeHandConfig(legacy), normalizeHandConfig(explicit), preset.id);
    assert.deepEqual(evaluateHandPose(legacy, .371), evaluateHandPose(explicit, .371), preset.id);
    assert.deepEqual(evaluateHandVoices(legacy, .371), evaluateHandVoices(explicit, .371), preset.id);
  }
  for (const source of VOICE_SOURCES) {
    const explicit = scene(source), legacy = clone(explicit);
    for (const voice of legacy.voices) for (const key of KEYS) delete voice[key];
    assert.deepEqual(render(engine(legacy)), render(engine(explicit)), source);
  }
});

test('JSON recall and full-state randomization retain and vary all six trims independently on every voice', () => {
  const config = scene(), original = clone(config);
  config.voices.forEach((voice, i) => Object.assign(voice, {
    pitch: -.9 + i * .4, tone: -.6 + i * .2, grain: .7 - i * .25,
    pan: -.8 + i * .35, attackScale: .3 + i * .7, releaseScale: 3.8 - i * .6,
  }));
  assert.deepEqual(normalizeHandConfig(JSON.parse(JSON.stringify(config))), config);
  const observed = Array.from({ length: 5 }, () => Object.fromEntries(KEYS.map(key => [key, new Set()])));
  for (let seed = 1; seed <= 16; seed++) {
    const random = randomizeHandConfig(original, seeded(seed));
    assert.deepEqual(normalizeHandConfig(JSON.parse(JSON.stringify(random))), random);
    random.voices.forEach((voice, i) => {
      for (const [key, [minimum, maximum]] of Object.entries(LIMITS)) {
        assert.ok(Number.isFinite(voice[key]) && voice[key] >= minimum && voice[key] <= maximum, `${i}/${key}`);
        observed[i][key].add(voice[key]);
      }
    });
  }
  assert.deepEqual(original, scene(), 'randomization must not mutate its input');
  observed.forEach((voice, i) => { for (const key of KEYS) assert.ok(voice[key].size > 2, `${i}/${key} is frozen`); });
});

test('pitch, tone, grain and pan change only their selected voice target without moving the hand or foot', () => {
  for (const form of ['hand', 'foot']) {
    const config = scene('glass', form), before = evaluateHandVoices(config, .317), pose = evaluateHandPose(config, .317);
    for (const [key, destination] of [['pitch', 'frequency'], ['tone', 'brightness'], ['grain', 'roughness'], ['pan', 'pan']]) {
      for (const value of [-.6, .6]) {
        const changed = clone(config); changed.voices[MIDDLE][key] = value;
        const after = evaluateHandVoices(changed, .317);
        assert.deepEqual(evaluateHandPose(changed, .317), pose, `${form}/${key} moved the model`);
        assert.equal(Math.sign(after[MIDDLE][destination] - before[MIDDLE][destination]), Math.sign(value), `${form}/${key}`);
        for (let i = 0; i < 5; i++) {
          if (i !== MIDDLE) assert.deepEqual(after[i], before[i], `${form}/${key} leaked to voice ${i}`);
          else for (const field of TARGETS) if (field !== destination) assert.equal(after[i][field], before[i][field], `${key} changed ${field}`);
        }
        if (key === 'pitch') close(after[MIDDLE].frequency / before[MIDDLE].frequency, 2 ** value);
      }
    }
    for (const key of ['attackScale', 'releaseScale']) {
      const changed = clone(config); changed.voices[MIDDLE][key] = 4;
      assert.deepEqual(evaluateHandPose(changed, .317), pose);
      const after = evaluateHandVoices(changed, .317);
      for (let i = 0; i < 5; i++) for (const field of TARGETS) assert.equal(after[i][field], before[i][field]);
    }
  }
});

test('extreme trims retain response to every finger, toe, wrist, ankle and foot-shape joint', () => {
  for (const form of ['hand', 'foot']) for (const end of [0, 1]) {
    const config = scene('wire', form);
    config.voices.forEach(voice => { for (const key of KEYS) voice[key] = LIMITS[key][end]; });
    const before = evaluateHandVoices(config, .31), edits = [];
    for (let i = 0; i < 5; i++) for (const key of handJointKeys(form, i)) {
      const [low, high] = handDigitLimits(form, i)[key];
      edits.push({ name: `${i}/${key}`, affected: [i], apply: c => { c.pose.fingers[i][key] += (high - low) * .04; } });
    }
    for (const [part, limits] of [['wrist', handWristLimits(form)], ...(form === 'foot' ? [['foot', FOOT_LIMITS.shape]] : [])]) {
      for (const [key, [low, high]] of Object.entries(limits)) edits.push({ name: `${part}/${key}`, affected: [0, 1, 2, 3, 4], apply: c => { c.pose[part][key] += (high - low) * .04; } });
    }
    for (const edit of edits) {
      const changed = clone(config); edit.apply(changed);
      const after = evaluateHandVoices(changed, .31);
      assert.ok(edit.affected.some(i => ['frequency', 'brightness', 'roughness', 'pan'].some(key => Math.abs(after[i][key] - before[i][key]) > 1e-9)), `${form}/${end}/${edit.name} lost its sound destination`);
    }
  }
});

test('every engine has audible independent pitch, tone, grain and stereo-pan trims', () => {
  for (const source of VOICE_SOURCES) {
    const config = scene(source), baseline = mono(render(engine(config)));
    assert.ok(rms(baseline) > .002, `${source} must exercise audible synthesis`);
    for (const key of ['pitch', 'tone', 'grain']) {
      const changed = clone(config); changed.voices[MIDDLE][key] = key === 'pitch' ? .7 : .6;
      const actual = mono(render(engine(changed)));
      assert.ok(difference(normalized(actual), normalized(baseline)) > .01, `${source}/${key} must change waveform shape, beyond overall gain`);
    }
    const left = clone(config), right = clone(config);
    left.voices[MIDDLE].pan = -.8; right.voices[MIDDLE].pan = .8;
    const a = render(engine(left)), b = render(engine(right));
    assert.ok(rms(a.left) > rms(a.right) * 3, `${source} left pan`);
    assert.ok(rms(b.right) > rms(b.left) * 3, `${source} right pan`);
  }
});

test('attack and release scales independently change the selected voice onset and tail', () => {
  const config = scene(); config.sound.attack = .08;
  const slowAttack = clone(config); slowAttack.voices[MIDDLE].attackScale = 4;
  const ordinary = engine(config), slower = engine(slowAttack);
  const a = render(ordinary, .025), b = render(slower, .025);
  assert.ok(rms(a.left) > rms(b.left) * 1.8, 'slower selected onset must be audible');
  assert.ok(slower.voices[MIDDLE].envelope < ordinary.voices[MIDDLE].envelope * .5);
  for (let i = 0; i < 5; i++) if (i !== MIDDLE) assert.equal(slower.voices[i].envelope, ordinary.voices[i].envelope, `attack leaked to voice ${i}`);
  const longRelease = clone(config); longRelease.voices[MIDDLE].releaseScale = 4;
  const short = engine(config), long = engine(longRelease);
  render(short, .4); render(long, .4); short.setSoundPlaying(false); long.setSoundPlaying(false);
  render(short, .16); render(long, .16);
  assert.ok(long.voices[MIDDLE].envelope > short.voices[MIDDLE].envelope * 100, 'longer selected release retains its tail');
  for (let i = 0; i < 5; i++) if (i !== MIDDLE) assert.equal(long.voices[i].envelope, short.voices[i].envelope, `release leaked to voice ${i}`);
  assert.ok(rms(render(long, .04).left) > rms(render(short, .04).left) * 100, 'release difference must reach sound');
});

test('Audio off keeps its fast mute regardless of per-voice release and clears queued auditions', () => {
  const slow = scene('marimba'); slow.sound.release = 3.5;
  slow.voices.forEach(voice => { voice.releaseScale = 4; });
  const fast = clone(slow); fast.voices.forEach(voice => { voice.releaseScale = .25; });
  const a = engine(slow), b = engine(fast);
  assert.deepEqual(render(a, .1), render(b, .1));
  for (const dsp of [a, b]) { dsp.auditionFinger(MIDDLE, 2); dsp.setSoundPlaying(false); dsp.setEnabled(false); }
  assert.deepEqual(render(a, .15), render(b, .15), 'Audio mute must not inherit envelope release scales');
  for (const dsp of [a, b]) {
    assert.equal(peak(render(dsp, .04).left), 0);
    dsp.setEnabled(true);
    assert.equal(peak(render(dsp, .04).left), 0, 'rearming must not replay the cancelled audition');
  }
});

test('all engines remain finite and bounded with extreme trims across 8–192 kHz sample rates', () => {
  for (const source of VOICE_SOURCES) for (const rate of [8000, 44100, 48000, 96000, 192000]) for (const end of [0, 1]) {
    const config = scene(source, end ? 'foot' : 'hand');
    Object.assign(config.sound, { rootHz: end ? 1600 : 35, brightness: end, roughness: end, space: 1, rotationFx: 1 });
    Object.assign(config.motion, { id: 'flourish', amount: 1, tempo: 1100, speed: 4 });
    config.voices.forEach(voice => { voice.level = 1; for (const key of KEYS) voice[key] = LIMITS[key][end]; });
    const dsp = engine(config, rate, true); renderFrames(dsp, 1024);
    assert.ok(dsp.targets.every(voice => voice.frequency >= 25 && voice.frequency <= Math.min(4200, rate * .17)), `${source}/${rate}/${end}: pitch ceiling`);
  }
});

test('live trim edits preserve clock, gates and oscillator phases and enter without an immediate jump', () => {
  for (const source of VOICE_SOURCES) {
    const config = scene(source);
    Object.assign(config.motion, { id: 'finger-roll', amount: .65 });
    const actual = engine(config, RATE, true), reference = engine(config, RATE, true);
    render(actual, .2); render(reference, .2);
    const smoothedFields = ['frequency', 'brightness', 'roughness', 'pan'];
    const before = { clock: actual.clock, time: actual.getMotionTime(), phases: actual.voices.map(v => [v.phase, v.modPhase]),
      voice: Object.fromEntries(smoothedFields.map(key => [key, actual.voices[MIDDLE][key]])) };
    const changed = clone(config);
    Object.assign(changed.voices[MIDDLE], { pitch: 1.2, tone: .8, grain: -.7, pan: -.8, attackScale: 3.2, releaseScale: .3 });
    actual.setConfig(changed);
    assert.equal(actual.clock, before.clock); assert.equal(actual.getMotionTime(), before.time);
    assert.equal(actual.enabled, true); assert.equal(actual.playing, true); assert.equal(actual.soundPlaying, true);
    assert.deepEqual(actual.voices.map(v => [v.phase, v.modPhase]), before.phases, `${source}: edit reset a phase`);
    const first = renderFrames(actual, 1), unchanged = renderFrames(reference, 1);
    assert.ok(Math.abs(first.left[0] - unchanged.left[0]) < .002 && Math.abs(first.right[0] - unchanged.right[0]) < .002, `${source}: discontinuity at edit`);
    for (const key of smoothedFields) {
      const distance = Math.abs(actual.targets[MIDDLE][key] - before.voice[key]);
      const moved = Math.abs(actual.voices[MIDDLE][key] - before.voice[key]);
      assert.ok(distance > 1e-6 && moved > 0 && moved < distance * .02, `${source}/${key}: live edit must enter through smoothing`);
    }
    // Noise and newly raised partials can naturally have large adjacent samples;
    // the edit boundary and smoothed control movement above measure discontinuity.
    renderFrames(actual, 1024);
  }
});

test('non-neutral trims preserve deterministic reset without changing transport or reallocating engine storage', () => {
  for (const source of VOICE_SOURCES) {
    const config = scene(source);
    Object.assign(config.voices[MIDDLE], { pitch: -.4, tone: .3, grain: .2, pan: .45, attackScale: 2.3, releaseScale: .4 });
    const dsp = engine(config), storage = dsp.voices.map(voice => [voice, voice.bow.buffer, voice.choir, voice.marimba]);
    dsp.reset(); const first = render(dsp, .15), clock = dsp.clock, time = dsp.getMotionTime();
    dsp.reset(); assert.equal(dsp.clock, clock); assert.equal(dsp.getMotionTime(), time);
    assert.equal(dsp.soundPlaying, true); assert.equal(dsp.enabled, true); assert.equal(dsp.playing, false);
    assert.deepEqual(dsp.config, config);
    assert.deepEqual(render(dsp, .15), first, `${source}: reset changed trimmed sound`);
    dsp.voices.forEach((voice, i) => { [voice, voice.bow.buffer, voice.choir, voice.marimba].forEach((item, j) => assert.equal(item, storage[i][j])); });
  }
});

test('trimmed moving voices and envelopes remain sample-identical across arbitrary audio block boundaries', () => {
  for (const source of ['pulse', 'air', 'choir', 'marimba']) {
    const config = scene(source, 'foot');
    Object.assign(config.voices[MIDDLE], { pitch: .35, tone: -.2, grain: .45, pan: -.4, attackScale: 2.7, releaseScale: 3.1 });
    Object.assign(config.motion, { id: 'finger-roll', amount: .7, tempo: 137, speed: 1.1 });
    Object.assign(config.sound, { rhythm: 'walk', noteLength: .37, attack: .013, release: .16, space: .2, rotationFx: .4 });
    const frames = 8191, expected = renderFrames(engine(config, RATE, true), frames, frames);
    assert.ok(rms(expected.left) > .001, `${source}: partition fixture must sound`);
    for (const block of [1, 7, 128, 257]) assert.deepEqual(renderFrames(engine(config, RATE, true), frames, block), expected, `${source}/${block}`);
  }
});
