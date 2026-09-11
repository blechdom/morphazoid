import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadSpellingPronunciations } from '../src/spelling-pronunciation.js';
import { SPELLING_DIPHONE_ATLAS_URL } from '../src/spelling-diphone-atlas.js';
import { RoachSynthDsp, ROACH_SOUND_DEFAULTS, ROACH_SOUND_PRESETS, ROACH_MOD_TARGETS, createDefaultRoachMappings, ROACH_BODY_GROUPS, ROACH_BODY_SOURCES, createDefaultRoachBodyMix, normalizeRoachBodyMix, createRandomRoachSound, getRoachBodyGroupId, ROACH_MOTION_SOUND_PRESETS, getRoachMotionSound } from '../src/roach-synth-dsp.js';
import { RoachSynthAudio, createRoachSpeechPlan, ROACH_RECORDINGS } from '../src/roach-synth-audio.js';
import { ROACH_MOTION_PRESETS, ROACH_STATIC_POSES, getRoachStaticPose, bakeRoachPresetTracks, createRoachSceneState, writeRoachSceneState, writeRoachPose } from '../src/roach-synth-motion.js';
import { getSharedAudioOutputManager } from '../src/audio-output-manager.js';

const labels = ['body', 'abdomen', 'head', 'neck', 'wing_covers', 'left_antenna', 'right_antenna'];
for (const side of ['left', 'right']) for (const leg of ['front', 'middle', 'hind']) {
  for (const segment of ['proximal', 'mid', 'distal']) labels.push(`${side}_${leg}_leg_${segment}`);
}
labels.push('left_front_foot', 'right_front_foot');
labels.push('wing_cover_left', 'wing_cover_right', 'wing_hind_left', 'wing_hind_right');
const joints = labels.map((name, i) => ({ id: `bone-${i}`, jointId: name, name,
  offset: { x: 0, y: 0, z: 0 }, motion: { enabled: false, axis: 'x', amplitude: 12, speed: .5 } }));
const RATE = 24000;
function engine(settings = {}) {
  const dsp = new RoachSynthDsp(RATE);
  dsp.update({ joints, mappings: [], enabled: true, playing: true, ...settings });
  return dsp;
}
function render(dsp, seconds = .6, blockSize = 128) {
  const left = new Float32Array(Math.round(seconds * RATE)); const right = new Float32Array(left.length);
  for (let offset = 0; offset < left.length; offset += blockSize) dsp.render(left.subarray(offset, offset + blockSize), right.subarray(offset, offset + blockSize));
  return { left, right };
}
function rms(samples) { return Math.sqrt(samples.reduce((energy, value) => energy + value * value, 0) / Math.max(1, samples.length)); }
function difference(a, b) { return rms(a.map((value, i) => value - b[i])); }
function recordingFixture() {
  return ['vivarium_scuttle', 'vivarium_rustle', 'vivarium_contact'].map((id, k) => ({ id, sampleRate: RATE, cues: [.04, .13],
    data: Float32Array.from({ length: RATE / 2 }, (_, i) => (Math.sin(i * 1.31 + k) + Math.sin(i * .417)) * .05) }));
}
function peak(samples) { return samples.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0); }
function reconstructedPeak4x(samples) {
  // Independent windowed-sinc construction, rather than copying the guard's
  // absolute polyphase table; includes interpolation ringing beyond both ends.
  function bessel0(value) {
    let term = 1; let sum = 1;
    for (let i = 1; i < 30; i += 1) { term *= value * value / (4 * i * i); sum += term; }
    return sum;
  }
  const taps = Float64Array.from({ length: 81 }, (_, i) => {
    const x = (i - 40) / 4; const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    return sinc * bessel0(5 * Math.sqrt(1 - ((i - 40) / 40) ** 2)) / bessel0(5);
  });
  const scale = 4 / taps.reduce((sum, value) => sum + value, 0);
  const reconstructed = new Float64Array(samples.length * 4 + 81);
  for (let i = 0; i < samples.length; i += 1) for (let tap = 0; tap < taps.length; tap += 1) {
    reconstructed[i * 4 + tap] += samples[i] * taps[tap] * scale;
  }
  return peak(reconstructed);
}

function solo(groupId, source, level = 1) {
  return createDefaultRoachBodyMix().map((row) => ({ ...row, source: row.groupId === groupId ? source : row.source, level: row.groupId === groupId ? level : 0 }));
}
const muted = () => createDefaultRoachBodyMix().map((row) => ({ ...row, level: 0 }));

test('eight anatomical groups own nineteen sources and normalized immutable assignments', () => {
  assert.equal(ROACH_BODY_GROUPS.length, 8); assert.equal(ROACH_BODY_SOURCES.length, 19);
  assert.equal(getRoachBodyGroupId(joints[2]), 'head'); assert.equal(getRoachBodyGroupId(joints[3]), 'neck');
  assert.equal(getRoachBodyGroupId(joints[4]), 'covers'); assert.equal(getRoachBodyGroupId(joints[29]), 'hindwings');
  assert.equal(getRoachBodyGroupId(joints[30]), 'hindwings'); assert.equal(getRoachBodyGroupId(joints[7]), 'legs');
  assert.equal(getRoachBodyGroupId(joints[5]), 'antennae'); assert.equal(getRoachBodyGroupId(joints[0]), 'thorax');
  const input = createDefaultRoachBodyMix(); const output = normalizeRoachBodyMix(input);
  input[0].level = 100; input[0].source = 'imaginary';
  assert.equal(output[0].source, 'footsteps'); assert.equal(output[0].level, .72);
  assert.equal(normalizeRoachBodyMix(input)[0].level, 1);
  assert.equal(normalizeRoachBodyMix([{ groupId: 'legs', source: 'drone', level: 0 }])[0].level, 0);
});

test('24 animation companions cover distinct instruments and reserve scuttle for one routine', () => {
  assert.deepEqual(ROACH_MOTION_SOUND_PRESETS.map((item) => item.motionId).sort(), ROACH_MOTION_PRESETS.map((item) => item.id).sort());
  assert.equal(new Set(ROACH_MOTION_SOUND_PRESETS.map((item) => JSON.stringify(item.bodyMix))).size, 24);
  assert.deepEqual(ROACH_MOTION_SOUND_PRESETS.filter((item) => item.bodyMix.some((row) => row.source === 'skuttle')).map((item) => item.motionId), ['side_skitter']);
  assert.equal(ROACH_SOUND_PRESETS[0].bodyMix[0].source, 'footsteps');
  assert.equal(ROACH_SOUND_PRESETS[0].bodyMix[5].source, 'sine');
  for (const source of ['footsteps', 'fm', 'rattle', 'pluck']) assert.ok(ROACH_SOUND_PRESETS.some((item) => item.bodyMix[0].source === source));
  const copy = getRoachMotionSound('side_walk'); copy.sound.pitch = 999; copy.bodyMix[0].source = 'skuttle';
  assert.notEqual(getRoachMotionSound('side_walk').sound.pitch, 999);
  assert.equal(getRoachMotionSound('side_walk').bodyMix[0].source, 'footsteps');
  assert.deepEqual(ROACH_SOUND_PRESETS.find((item) => item.id === 'wing-radio').bodyMix.map((row) => row.level), [.85,.48,.65,.68,.6,.36,.36,.24]);
});

test('percussion source changes do not freeze and resurrect a previous strike', () => {
  for (const source of ['footsteps', 'fm', 'rattle', 'pluck', 'click', 'clack']) {
    const dsp = engine({ playing: false, soundPlaying: false, motion: { presetId: 'none', antennae: false }, bodyMix: solo('head', source) });
    render(dsp, .1); dsp.interact({ jointId: joints[2].id, active: true, velocity: 1 });
    assert.ok(peak(render(dsp, .015).left) > .005);
    dsp.interact({ active: false }); dsp.update({ bodyMix: solo('head', 'drone') }); render(dsp, 1.2);
    dsp.update({ bodyMix: solo('head', source) });
    assert.ok(peak(render(dsp, .2).left) < 1e-7, `${source} revived a stale strike`);
    dsp.interact({ jointId: joints[2].id, active: true, velocity: 1 });
    assert.ok(peak(render(dsp, .05).left) > .005, `${source} must still accept a fresh gesture`);
  }
});

test('queued source changes clear an unsampled percussion strike before reselecting it', () => {
  for (const source of ['footsteps', 'fm', 'rattle', 'pluck', 'click', 'clack']) {
    const dsp = engine({ playing: false, soundPlaying: false, motion: { presetId: 'none', antennae: false }, bodyMix: solo('head', source) });
    dsp.interact({ jointId: joints[2].id, active: true, velocity: 1 });
    assert.equal(dsp.body.voices[6].percussion.events, 1);
    // Worklet messages can queue multiple assignments before the first sample;
    // the second change replaces both the current and fading percussion source.
    dsp.interact({ active: false });
    dsp.update({ bodyMix: solo('head', 'drone') });
    dsp.update({ bodyMix: solo('head', 'sine') });
    render(dsp, 1.2);
    dsp.update({ bodyMix: solo('head', source) });
    assert.ok(peak(render(dsp, .2).left) < 1e-7, `${source} revived a never-rendered strike`);
    dsp.interact({ jointId: joints[2].id, active: true, velocity: 1 });
    assert.ok(peak(render(dsp, .05).left) > .005, `${source} must accept a new strike after cleanup`);
  }
});

test('clear footsteps follow the shared beat-grid contacts without extra movement-generated hits', () => {
  const dsp = engine({ motion: { presetId: 'side_run', tempo: 120 }, bodyMix: solo('legs', 'footsteps') });
  const contact = dsp.body.contact.bind(dsp.body); const times = [];
  dsp.body.contact = (index, strength) => { times.push(dsp.time); contact(index, strength); };
  const signal = render(dsp, 2);
  assert.ok(times.length >= 36); assert.equal(dsp.body.voices[0].percussion.events, times.length);
  for (const time of times) assert.ok(Math.abs(time * 2 * 4 - Math.round(time * 2 * 4)) <= .041, `off-grid foot ${time}`);
  assert.ok(peak(signal.left) > .025); assert.ok(rms(signal.left) > .004);
  dsp.update({ playing: false }); render(dsp, .8); assert.ok(peak(render(dsp, .1).left) < 1e-7);
});

test('realistic foot strengths retain audible FM, modal and Karplus detail beside clear taps', () => {
  const outputs = [];
  for (const source of ['footsteps', 'fm', 'rattle', 'pluck']) {
    const dsp = engine({ motion: { presetId: 'none', tempo: 120, antennae: false }, bodyMix: solo('legs', source, .72) });
    render(dsp, .05); const signal = [];
    for (let step = 0; step < 4; step += 1) {
      for (const foot of step % 2 ? [1, 2, 5] : [0, 3, 4]) dsp.triggerFoot(foot, .3);
      signal.push(...render(dsp, .125).left);
    }
    assert.equal(dsp.body.voices[0].percussion.events, 12); outputs.push(Float32Array.from(signal));
  }
  const reference = rms(outputs[0]);
  for (let i = 1; i < outputs.length; i += 1) {
    assert.ok(rms(outputs[i]) > reference * .35, 'ordinary contact strength must not disappear into two multiplied envelopes');
    assert.ok(rms(outputs[i]) < reference * 2.2, 'one percussion source must not overpower the other foot instruments');
    assert.ok(difference(outputs[0], outputs[i]) > reference * .5);
  }
});

test('Click and Clack have distinct dry and woody tails from one real foot strike', () => {
  const signals = [];
  for (const source of ['click', 'clack']) {
    const dsp = engine({ motion: { presetId: 'none', antennae: false }, bodyMix: solo('legs', source) });
    render(dsp, .1); const slots = dsp.body.voices[0].percussion.slots;
    dsp.triggerFoot(0, .6); const signal = render(dsp, .1).left;
    assert.ok(peak(signal) > .025); assert.equal(dsp.body.voices[0].percussion.events, 1);
    assert.equal(dsp.body.voices[0].percussion.slots, slots); signals.push(signal);
    dsp.update({ playing: false, soundPlaying: true }); render(dsp, .5);
    assert.ok(peak(render(dsp, .1).left) < 1e-7, `${source} must not loop while held`);
  }
  assert.ok(rms(signals[0].subarray(RATE * .035)) < rms(signals[1].subarray(RATE * .035)) * .2);
  assert.ok(difference(signals[0], signals[1]) > .015);
  assert.equal(getRoachMotionSound('side_tiptoe').bodyMix[0].source, 'click');
  assert.equal(getRoachMotionSound('dance_robot').bodyMix[0].source, 'clack');
});

test('optional metronome uses the sample clock, preserves phase through pause and never arms sound', () => {
  const dsp = engine({ enabled: false, playing: true, metronome: true, bodyMix: muted(), motion: { presetId: 'none', tempo: 120, antennae: false } });
  assert.equal(peak(render(dsp, .2).left), 0); assert.equal(dsp.metronomeEvents, 0);
  dsp.update({ enabled: true }); render(dsp, .2); assert.equal(dsp.metronomeEvents, 0, 'arming between beats does not invent a click');
  const signal = render(dsp, .2); assert.equal(dsp.metronomeEvents, 1); assert.ok(peak(signal.left) > .02);
  assert.ok(Math.abs(dsp.lastMetronomeTime - .5) < 1 / RATE);
  dsp.update({ playing: false }); render(dsp, .2); assert.equal(dsp.metronomeEvents, 1);
  dsp.update({ playing: true }); render(dsp, .2); assert.equal(dsp.metronomeEvents, 1, 'resume mid-beat waits for the next grid point');
  render(dsp, .3); assert.equal(dsp.metronomeEvents, 2);
  dsp.update({ metronome: false }); render(dsp, .2); assert.ok(peak(render(dsp, .2).left) < 1e-7);
  assert.equal(dsp.metronomeEvents, 2);
  const first = engine({ metronome: true, bodyMix: muted(), motion: { presetId: 'none', tempo: 90, antennae: false } });
  render(first, .7); assert.equal(first.metronomeEvents, 2); assert.ok(Math.abs(first.lastMetronomeTime - 2 / 3) <= 1 / RATE);
});

test('held Sound Play is healthy smooth sound without motion, grains, or fictional contacts', () => {
  const dsp = engine({ playing: false, soundPlaying: true, motion: { presetId: 'none', antennae: false } });
  dsp.setSampleBank(recordingFixture());
  const output = render(dsp, 1.4).left;
  assert.ok(rms(output) > .035 && rms(output) < .17);
  assert.ok(peak(output) < .8); assert.equal(dsp.time, 0); assert.ok(dsp.soundTime > 1.39);
  assert.equal(dsp.contactEvents, 0); assert.equal(dsp.recordings.events, 0);
  for (const voice of dsp.body.voices) { assert.equal(voice.motion, 0); assert.equal(voice.manual, 0); }
  dsp.update({ soundPlaying: false }); render(dsp, .75);
  assert.ok(peak(render(dsp, .1).left) < 1e-7);
});

test('every movement-only source is exactly silent for held poses even when Sound Play runs', () => {
  for (const source of ROACH_BODY_SOURCES.filter((item) => item.motionOnly)) {
    const dsp = engine({ playing: false, soundPlaying: true, motion: { presetId: 'none', antennae: false },
      joints: joints.map((joint) => ({ ...joint, offset: { x: 32, y: -19, z: 27 } })),
      bodyMix: createDefaultRoachBodyMix().map((row) => ({ ...row, source: source.id, level: 1 })) });
    dsp.setSampleBank(recordingFixture());
    assert.equal(peak(render(dsp, .7).left), 0, `${source.id} invented movement sound for a still pose`);
    assert.equal(dsp.contactEvents, 0); assert.equal(dsp.recordings.events, 0);
  }
});

test('each source actually sounds from its assigned group and resets on still pose changes', () => {
  for (const source of ROACH_BODY_SOURCES) {
    const dsp = engine({ playing: false, soundPlaying: !source.motionOnly, motion: { presetId: 'none', antennae: false }, bodyMix: solo('head', source.id) });
    dsp.setSampleBank(recordingFixture()); render(dsp, .1);
    if (source.motionOnly) dsp.interact({ jointId: joints[2].id, active: true, velocity: 1 });
    assert.ok(rms(render(dsp, .15).left) > .003, `${source.id} has no assigned source signal`);
    dsp.interact({ active: false });
    dsp.update({ resetActivity: true, joints: joints.map((joint, i) => i === 2 ? { ...joint, offset: { x: 45, y: 25, z: -19 } } : joint) });
    render(dsp, .9);
    if (source.motionOnly) assert.ok(peak(render(dsp, .1).left) < 1e-7, `${source.id} remains active after a discrete held-pose edit`);
    assert.equal(dsp.time, 0);
  }
});

test('a static preset teleport does not audition movement-only body sources', () => {
  const bodyMix = createDefaultRoachBodyMix().map((row, i) => ({ ...row, source: i % 2 ? 'rustle' : 'skuttle', level: 1 }));
  const dsp = engine({ playing: false, soundPlaying: true, motion: { presetId: 'none', antennae: false }, bodyMix });
  dsp.setSampleBank(recordingFixture()); render(dsp, .1);
  dsp.update({ resetActivity: true, joints: joints.map((joint) => ({ ...joint, offset: { x: 65, y: -40, z: 20 } })) });
  assert.equal(peak(render(dsp, 1).left), 0); assert.equal(dsp.recordings.events, 0);
});

test('pushing an offset beyond its physical limit is silent until the constrained joint actually moves', () => {
  const joint = { id: 'head', jointId: 'head', name: 'Head', offset: { x: 20, y: 0, z: 0 },
    poseLimits: { x: [-10, 10], y: [-10, 10], z: [-10, 10] } };
  for (const source of ['walls', 'rustle', 'zing']) {
    const dsp = engine({ joints: [joint], mappings: [], playing: false, soundPlaying: true,
      motion: { presetId: 'none', antennae: false }, bodyMix: solo('head', source) });
    dsp.setSampleBank(recordingFixture()); render(dsp, .15); assert.equal(dsp.pose[0], 10);
    const time = dsp.time; const retained = dsp.editedPose;
    dsp.interact({ jointId: 'head', active: true, velocity: 0 });
    dsp.update({ joints: [{ ...joint, offset: { x: 70, y: 0, z: 0 } }] });
    assert.equal(dsp.pose[0], 10); assert.equal(dsp.time, time);
    assert.equal(peak(render(dsp, .2).left), 0, `${source} sounded from an unchanged constrained pose`);
    assert.equal(dsp.recordings.events, 0);
    dsp.update({ joints: [{ ...joint, offset: { x: -8, y: 0, z: 0 } }] });
    assert.equal(dsp.pose[0], -8);
    assert.ok(rms(render(dsp, .1).left) > .003, `${source} must still respond inside the physical range`);
    assert.equal(dsp.editedPose, retained, 'the message-boundary comparison reuses its fixed buffer');
  }
});

test('moving antennae cannot excite the legs instrument; every group has its own movement gate', () => {
  const representatives = [7, 4, 29, 0, 1, 3, 2, 5];
  for (let group = 0; group < ROACH_BODY_GROUPS.length; group += 1) {
    const id = ROACH_BODY_GROUPS[group].id;
    const dsp = engine({ playing: false, motion: { presetId: 'none', antennae: false }, bodyMix: solo(id, 'walls') });
    render(dsp, .1);
    dsp.interact({ jointId: joints[representatives[(group + 1) % 8]].id, active: true, velocity: 1 });
    assert.equal(peak(render(dsp, .15).left), 0, `${id} received another group's gesture`);
    dsp.interact({ jointId: joints[representatives[group]].id, active: true, velocity: 1 });
    assert.ok(rms(render(dsp, .12).left) > .004, `${id} did not receive its own gesture`);
    dsp.interact({ active: false }); render(dsp, .8);
    assert.ok(peak(render(dsp, .1).left) < 1e-7);
  }
  const untouched = engine({ motion: { presetId: 'side_run' }, bodyMix: solo('legs', 'skuttle') });
  const antenna = engine({ motion: { presetId: 'side_run' }, bodyMix: solo('legs', 'skuttle') });
  render(untouched, .2); render(antenna, .2);
  antenna.interact({ jointId: joints[5].id, active: true, velocity: 1 });
  assert.deepEqual(render(untouched, .4).left, render(antenna, .4).left, 'leg noise and phase must not share another group\'s random/excitation stream');
});

test('XYZ and left/right articulation make distinct sound within one assigned instrument', () => {
  function posed(index, axis, value) {
    return engine({ playing: false, soundPlaying: true, motion: { presetId: 'none', antennae: false }, bodyMix: solo('antennae', 'resonance'),
      joints: joints.map((joint, i) => i === index ? { ...joint, offset: { x: 0, y: 0, z: 0, [axis]: value } } : joint) });
  }
  const neutral = render(posed(5, 'x', 0), .6);
  for (const axis of ['x', 'y', 'z']) assert.ok(difference(neutral.left, render(posed(5, axis, 38), .6).left) > .001, `${axis} has no audible assignment`);
  assert.ok(difference(render(posed(5, 'x', 38), .6).left, render(posed(6, 'x', 38), .6).left) > .003);
  const left = render(posed(5, 'z', -40), .6); const right = render(posed(6, 'z', 40), .6);
  assert.ok(rms(left.left) > rms(left.right) * 1.4); assert.ok(rms(right.right) > rms(right.left) * 1.4);
});

test('a held pose pan/filter change does not produce a discontinuous first output sample', () => {
  for (const age of [.3, .331, .35, .38]) {
    const initial = joints.map((joint, i) => i === 2 ? { ...joint, offset: { x: 0, y: 0, z: -60 } } : joint);
    const config = { playing: false, soundPlaying: true, motion: { presetId: 'none', antennae: false }, bodyMix: solo('head', 'sub'), joints: initial };
    const edited = engine(config); const held = engine(config);
    render(edited, age); render(held, age);
    edited.update({ resetActivity: true, joints: joints.map((joint, i) => i === 2 ? { ...joint, offset: { x: 0, y: 0, z: 60 } } : joint) });
    const after = render(edited, .002); const reference = render(held, .002);
    assert.ok(Math.abs(after.left[0] - reference.left[0]) < .002);
    assert.ok(Math.abs(after.right[0] - reference.right[0]) < .002);
    assert.equal(edited.contactEvents, 0); assert.equal(edited.recordings.events, 0);
  }
});

test('body mute/solo levels are independent of modulation and never mute explicitly spoken words', () => {
  const bodyMix = muted(); const dsp = engine({ soundPlaying: true, bodyMix, mappings: createDefaultRoachMappings(joints) });
  dsp.setSampleBank(recordingFixture()); dsp.interact({ jointId: joints[7].id, active: true, velocity: 1 });
  assert.equal(peak(render(dsp, .4).left), 0);
  dsp.setAtlas(recordingFixture()[0].data, RATE); dsp.speak([{ offset: 0, duration: .35 }]);
  assert.ok(rms(render(dsp, .2).left) > .008);
  dsp.update({ sound: { voice: 0 } }); render(dsp, .6);
  assert.ok(peak(render(dsp, .1).left) < 1e-7);
});

test('eighteen sound patches and seeded random sounds retain body routing and safe output', () => {
  assert.ok(ROACH_SOUND_PRESETS.length >= 16); const outputs = [];
  for (const preset of ROACH_SOUND_PRESETS) {
    assert.equal(preset.bodyMix.length, 8);
    const dsp = engine({ soundPlaying: true, sound: preset.sound, bodyMix: preset.bodyMix, motion: { presetId: 'side_run' } });
    dsp.setSampleBank(recordingFixture()); const signal = render(dsp, .5).left;
    assert.ok(signal.every(Number.isFinite)); assert.ok(peak(signal) < .96); assert.ok(rms(signal) > .01); outputs.push(signal);
  }
  for (let i = 1; i < outputs.length; i += 1) assert.ok(difference(outputs[0], outputs[i]) > .003);
  assert.deepEqual(createRandomRoachSound(72), createRandomRoachSound(72));
  assert.notDeepEqual(createRandomRoachSound(72), createRandomRoachSound(73));
  const dsp = engine({ playing: false, soundPlaying: true });
  for (let seed = 1; seed <= 32; seed += 1) {
    const state = createRandomRoachSound(seed); dsp.update(state);
    assert.equal(state.bodyMix.length, 8); assert.ok(state.bodyMix.filter((row) => !ROACH_BODY_SOURCES.find((item) => item.id === row.source).motionOnly).length >= 2);
    const signal = render(dsp, .05).left; assert.ok(signal.every(Number.isFinite)); assert.ok(peak(signal) < .96);
  }
  assert.equal(dsp.time, 0); assert.ok(dsp.soundTime > 1.59);
});

test('random sound and authored presets vary every consumed global control; wing rate and rhythm are audible', () => {
  const random = Array.from({ length: 32 }, (_, i) => createRandomRoachSound((i + 1) * 2654435761 >>> 0));
  for (const key of ['pitch', 'brightness', 'resonance', 'crunch', 'vowel', 'wingRate', 'rhythm', 'pan', 'voice']) {
    assert.ok(new Set(random.map((item) => item.sound[key])).size >= 16, `${key} was not randomized`);
    assert.ok(new Set(ROACH_SOUND_PRESETS.map((item) => item.sound[key])).size >= 6, `${key} has no authored preset range`);
  }
  assert.ok(random.every((item) => item.sound.level === ROACH_SOUND_DEFAULTS.level), 'randomization does not turn up the master');
  function gesture(source, sound) {
    const dsp = engine({ playing: false, motion: { presetId: 'none', antennae: false }, bodyMix: solo('head', source), sound });
    render(dsp, .12); dsp.interact({ jointId: joints[2].id, active: true, velocity: 1 });
    return render(dsp, .18).left;
  }
  assert.ok(difference(gesture('buzz', { wingRate: 24 }), gesture('buzz', { wingRate: 180 })) > .003);
  assert.ok(difference(gesture('walls', { rhythm: .3 }), gesture('walls', { rhythm: 3 })) > .003);
});

test('group-owned recording pools adopt transferred buffers and never steal another group voice', () => {
  const dsp = engine({ playing: false }); const bank = recordingFixture(); dsp.setSampleBank(bank);
  assert.notEqual(dsp.recordings.bank[0].data, bank[0].data);
  dsp.setSampleBank(bank, { transferred: true }); assert.equal(dsp.recordings.bank[0].data, bank[0].data);
  assert.equal(dsp.recordings.voices.length, 16); const groups = new Float64Array(8);
  for (let group = 0; group < 8; group += 1) dsp.recordings.trigger(1, 1, .9, group);
  for (let i = 0; i < RATE * .04; i += 1) dsp.recordings.sample(groups);
  assert.ok(groups.every((value) => value !== 0));
  for (let group = 0; group < 8; group += 1) dsp.recordings.trigger(1, 1, .9, group);
  assert.equal(dsp.recordings.events, 16);
  for (let i = 0; i < RATE * .04; i += 1) dsp.recordings.sample(groups);
  dsp.recordings.trigger(1, 1, .9, 0); assert.equal(dsp.recordings.events, 16, 'third same-group fragment must be dropped');
  dsp.recordings.release(); for (let i = 0; i < RATE * .4; i += 1) dsp.recordings.sample(groups);
  assert.equal(dsp.recordings.sample(groups), 0); assert.ok(groups.every((value) => value === 0));
});

test('all group sources at hostile limits keep fixed storage, headroom and finite releases', () => {
  const dsp = engine({ playing: true, soundPlaying: true, motion: { presetId: 'side_run', tempo: 250 },
    sound: { level: 1e9, pitch: Infinity, brightness: 1, resonance: 1, crunch: 1, voice: 1 },
    mappings: Array.from({ length: 500 }, () => ({ jointId: joints[0].id, target: 'pitch', source: 'xyz', amount: 1e9 })) });
  dsp.setSampleBank(recordingFixture()); dsp.setAtlas(recordingFixture()[0].data, RATE);
  const voices = [...dsp.body.voices]; const lines = voices.map((voice) => [...voice.zing.lines]); const recordingPool = dsp.recordings.voices;
  assert.ok(dsp.mappings.length <= 128);
  for (const source of ROACH_BODY_SOURCES) {
    dsp.update({ bodyMix: createDefaultRoachBodyMix().map((row) => ({ ...row, source: source.id, level: 1e9 })) });
    dsp.speak([{ offset: 0, duration: .4 }]);
    for (let group = 0; group < 8; group += 1) dsp.body.excite(group, 1);
    const signal = render(dsp, .12);
    assert.ok(signal.left.every(Number.isFinite)); assert.ok(signal.right.every(Number.isFinite));
    assert.ok(peak(signal.left) < .97 && peak(signal.right) < .97);
  }
  for (let i = 0; i < 8; i += 1) {
    assert.equal(dsp.body.voices[i], voices[i]); assert.equal(dsp.body.voices[i].zing.lines[0], lines[i][0]);
    assert.equal(dsp.body.voices[i].zing.lines[1], lines[i][1]);
  }
  assert.equal(dsp.recordings.voices, recordingPool);
  dsp.update({ enabled: false, soundPlaying: false, playing: false, resetActivity: true }); render(dsp, .8);
  assert.ok(peak(render(dsp, .1).left) < 1e-7);
});

test('sixteen coherent real recording grains retain headroom at maximum accepted mixer gain', () => {
  const dsp = engine({ playing: false, soundPlaying: true, motion: { presetId: 'none', antennae: false },
    bodyMix: createDefaultRoachBodyMix().map((row) => ({ ...row, source: 'rustle', level: 1 })),
    sound: { level: .8, brightness: 1, crunch: 0, voice: 0 } });
  dsp.setSampleBank(ROACH_RECORDINGS.map(({ id, url, cues }) => {
    const bytes = readFileSync(url);
    assert.equal(bytes.toString('ascii', 36, 40), 'data');
    const data = Float32Array.from({ length: bytes.readUInt32LE(40) / 2 }, (_, i) => bytes.readInt16LE(44 + i * 2) / 32768);
    return { id, cues, data, sampleRate: bytes.readUInt32LE(24) };
  }));
  render(dsp, .15);
  let largest = 0; let guarded = false;
  const outputL = []; const outputR = [];
  for (let burst = 0; burst < 8; burst += 1) {
    for (let group = 0; group < 8; group += 1) dsp.recordings.trigger(1, 1, .5, group);
    const signal = render(dsp, .04);
    for (const channel of [signal.left, signal.right]) {
      assert.ok(channel.every(Number.isFinite));
      largest = Math.max(largest, peak(channel));
    }
    outputL.push(...signal.left); outputR.push(...signal.right);
    guarded ||= dsp.outputGuard.gains.some((gain) => gain < 1);
  }
  assert.ok(dsp.recordings.events >= 16, 'the stress case must fill all sixteen group-owned voices');
  assert.ok(guarded, 'the real recordings must exercise reconstruction protection');
  assert.ok(largest <= .9, `coherent grains exceeded the reserved headroom: ${largest}`);
  dsp.update({ enabled: false, soundPlaying: false, resetActivity: true });
  const tail = render(dsp, .8); outputL.push(...tail.left); outputR.push(...tail.right);
  assert.ok(reconstructedPeak4x(outputL) <= .900001);
  assert.ok(reconstructedPeak4x(outputR) <= .900001);
  assert.ok(peak(render(dsp, .1).left) < 1e-7);
});

test('reconstruction guard preserves ordinary samples with a fixed delay and bounds arbitrary correlated peaks', () => {
  const guard = engine().outputGuard; const delay = guard.delayFrames;
  const ordinary = Float64Array.from({ length: 512 }, (_, i) => Math.sin(i * .53) * .3);
  const out = [];
  for (let i = 0; i < ordinary.length + delay; i += 1) { guard.sample(ordinary[i] || 0, 0); out.push(guard.left); }
  assert.deepEqual(out.slice(0, delay), Array(delay).fill(0));
  assert.deepEqual(out.slice(delay), Array.from(ordinary));
  const fresh = engine().outputGuard; const retained = fresh.gains; let seed = 82719; const left = []; const right = [];
  for (let i = 0; i < 4096 + delay; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const a = i < 4096 ? (seed / 0x100000000 * 2 - 1) : 0;
    const b = i < 4096 ? (i % 5 === 0 ? 1 : -1) : 0;
    fresh.sample(a, b); left.push(fresh.left); right.push(fresh.right);
  }
  assert.equal(fresh.gains, retained);
  assert.ok(reconstructedPeak4x(left) <= .900001);
  assert.ok(reconstructedPeak4x(right) <= .900001);
});


test('audio starts silent and has bounded release without stopping its transport clock', () => {
  assert.equal(peak(render(engine({ sound: { level: 0 } })).left), 0, 'zero master at first arm must not blip');
  assert.equal(peak(render(engine({ playing: false, soundPlaying: true, sound: { level: 0 } })).left), 0, 'Sound Play respects a preselected zero master');
  const dsp = new RoachSynthDsp(RATE);
  dsp.update({ playing: true, joints });
  assert.equal(peak(render(dsp).left), 0);
  dsp.update({ enabled: true });
  assert.ok(rms(render(dsp).left) > .002);
  const before = dsp.time;
  dsp.update({ enabled: false });
  const muted = render(dsp, .65).left;
  assert.ok(rms(muted.slice(-RATE / 10)) < 1e-7);
  assert.ok(dsp.time > before + .64);
  dsp.update({ enabled: true }); render(dsp);
  dsp.update({ playing: false });
  const stoppedAt = dsp.time; const tail = render(dsp, .65).left;
  assert.equal(dsp.time, stoppedAt);
  assert.ok(rms(tail.slice(-RATE / 10)) < 1e-7);
});

test('rendering is identical across arbitrary block boundaries and needs no display updates', () => {
  const a = engine(); const b = engine();
  const standard = render(a, .75, 128); const odd = render(b, .75, 73);
  assert.deepEqual(standard.left, odd.left); assert.deepEqual(standard.right, odd.right);
  assert.equal(a.telemetry.renderedFrames, RATE * .75);
  assert.ok(a.time > .749);
  const staticA = engine({ playing: false, soundPlaying: true });
  const staticB = engine({ playing: false, soundPlaying: true });
  assert.deepEqual(render(staticA, .75, 128).left, render(staticB, .75, 73).left);
  assert.equal(staticA.time, 0); assert.ok(staticA.soundTime > .749);
});

test('grounding calibration is preserved as a neutral sound baseline', () => {
  const settings = { playing: false, soundPlaying: true, motion: { presetId: 'none', antennae: false }, sound: { drone: .6 } };
  const plain = engine(settings);
  const grounded = engine({ ...settings, joints: joints.map((joint) => ({ ...joint, restOffset: { x: 75, y: -35, z: 44 } })) });
  assert.equal(grounded.joints[7].restOffset.x, 75);
  const gaitPose = { back: [-10, 20, 30], front: [10, -20, 30], raisedBack: [-30, 15, 35], raisedFront: [30, -15, 35] };
  const calibrated = engine({ ...settings, joints: joints.map((joint, i) => i === 7 ? { ...joint, gaitPose } : joint) });
  assert.deepEqual(calibrated.joints[7].gaitPose, gaitPose);
  assert.notEqual(calibrated.joints[7].gaitPose.front, gaitPose.front, 'the audio state owns its calibration arrays');
  assert.deepEqual(render(plain, .4).left, render(grounded, .4).left, 'neutral ground pose must not bias any mapped parameter');
});

test('joint collision metadata is bounded, immutable and refreshed when a same-ID rig changes', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const body = { ...joints[0], kinematics: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], parentMatrix: identity, footTip: null },
    poseLimits: { x: [-45, 45], y: [-45, 45], z: [-45, 45] },
    bodyEllipsoid: { jointId: joints[0].id, center: [0, 0, 0], radii: [1, 2, 1] },
    collisionSamples: Array.from({ length: 20 }, (_, i) => [i, 0, 0]) };
  const dsp = engine({ playing: false, joints: [body] });
  assert.equal(dsp.joints[0].collisionSamples.length, 8);
  const original = dsp.joints[0];
  body.kinematics.position[0] = 100; body.poseLimits.x[1] = 5; body.bodyEllipsoid.radii[0] = 4;
  assert.equal(original.kinematics.position[0], 0); assert.equal(original.poseLimits.x[1], 45); assert.equal(original.bodyEllipsoid.radii[0], 1);
  dsp.update({ joints: [body] });
  assert.notEqual(dsp.joints[0], original, 'a changed physical rig must invalidate joint-identity geometry caches');
  assert.equal(dsp.joints[0].kinematics.position[0], 100);
  assert.equal(peak(render(dsp, .2).left), 0, 'geometry reinitialization must not be mistaken for a manual drag');
});

test('grounded foot events follow shared contacts, stay quiet in flight and never fire on stationary offsets', () => {
  const dsp = engine({ motion: { presetId: 'side_run', antennae: false }, mappings: [] });
  const scene = createRoachSceneState(); let expected = 0;
  const previous = new Float64Array(6); let primed = false;
  for (let sample = 0; sample < RATE; sample += dsp.controlStride) {
    writeRoachSceneState(sample / RATE, dsp.motion, scene, dsp.joints);
    for (let i = 0; i < 6; i += 1) {
      if (primed && scene.feet[i].stance && scene.feet[i].impact > 0 && scene.feet[i].contactCount > previous[i]) expected += 1;
      previous[i] = scene.feet[i].contactCount;
    }
    primed = true;
  }
  render(dsp, 1);
  assert.ok(expected >= 6);
  assert.equal(dsp.contactEvents, expected);
  const flight = engine({ motion: { presetId: 'top_flight' } }); render(flight, 1.5);
  assert.equal(flight.contactEvents, 0, 'airborne legs must not hit an invisible floor');
  const still = engine({ motion: { presetId: 'none', antennae: false },
    joints: joints.map((joint) => ({ ...joint, offset: { x: 20, y: 15, z: -12 } })) });
  assert.equal(peak(render(still, .8).left), 0);
  assert.equal(still.contactEvents, 0);
  const frozen = engine({ motion: { intensity: 0, antennae: false } }); render(frozen, 1.2);
  assert.equal(frozen.contactEvents, 0);
});

test('a repeating individual leg score makes keyed contacts and rests without switching presets', () => {
  const steps = [0, 30, 40, 25, -20, -20, 0, 0, 0, 35, 20, -25, -25, 0, 0, 0];
  const dsp = engine({ mappings: [], motion: { presetId: 'none', antennae: false,
    sequenceEnabled: true, stepBeats: .25, tempo: 120,
    tracks: [{ jointId: joints[7].id, axis: 'x', enabled: true, steps }] } });
  const first = render(dsp, 2).left; const contacts = dsp.contactEvents;
  const second = render(dsp, 2).left;
  assert.equal(contacts, 2); assert.equal(dsp.contactEvents, contacts * 2);
  assert.ok(rms(first) > .001); assert.ok(rms(second) > .001);
  assert.equal(dsp.motion.presetId, 'none');
  const inactive = engine({ motion: { presetId: 'none', antennae: false, sequenceEnabled: false,
    tracks: [{ jointId: joints[7].id, axis: 'x', enabled: true, steps }] } });
  assert.equal(peak(render(inactive, 2).left), 0); assert.equal(inactive.contactEvents, 0);
});

test('all 24 static pose presets produce distinct sound without moving their body or animation clock', () => {
  assert.equal(ROACH_STATIC_POSES.length, 24);
  const outputs = [];
  for (const preset of ROACH_STATIC_POSES) {
    const shape = getRoachStaticPose(preset.id, joints);
    const posed = joints.map((joint) => ({ ...joint, offset: shape.offsets.find((offset) => offset.jointId === joint.id) }));
    const dsp = engine({ playing: false, soundPlaying: true, joints: posed,
      motion: { presetId: 'none', antennae: false, staticScene: shape.scene } });
    const initialPose = new Float32Array(dsp.pose);
    const output = render(dsp, .9).left;
    assert.equal(dsp.time, 0); assert.equal(dsp.contactEvents, 0);
    assert.deepEqual(dsp.pose, initialPose, `${preset.id} moved while only Sound Play was running`);
    assert.ok(rms(output) > .0005, `${preset.id} has no static-pose sound`);
    assert.ok(output.every(Number.isFinite)); assert.ok(peak(output) < .8);
    outputs.push(output);
  }
  const unique = outputs.filter((output, i) => outputs.slice(0, i).every((previous) => difference(output, previous) > .00001));
  assert.ok(unique.length >= 8, 'held-pose sources should cover distinct spectral regions; movement-only rows correctly stay silent');
});

test('baked joint contours and scene frames survive the audio boundary without double-applying factory motion', () => {
  const motion = bakeRoachPresetTracks('side_run', joints);
  const dsp = engine({ motion, time: .35 });
  assert.equal(dsp.motion.trackMode, 'replace'); assert.equal(dsp.motion.tracks.length, 93);
  assert.equal(dsp.motion.tracks[0].samples.length, 64); assert.equal(dsp.motion.sceneFrames.length, 64);
  const expected = writeRoachPose(.35, motion, joints, new Float32Array(joints.length * 3));
  dsp.control();
  assert.deepEqual(dsp.pose.slice(0, expected.length), expected);
  assert.ok(rms(render(dsp, .6).left) > .001);
});

test('Sound Play stays muted with Audio off while both independent clocks keep their intended state', () => {
  const dsp = engine({ enabled: false, playing: false, soundPlaying: true });
  assert.equal(peak(render(dsp, .4).left), 0); assert.equal(dsp.time, 0); assert.ok(dsp.soundTime > .399);
  dsp.update({ enabled: true }); assert.ok(rms(render(dsp, .4).left) > .001);
  dsp.update({ enabled: false }); const muted = render(dsp, .6).left;
  assert.ok(rms(muted.slice(-RATE / 10)) < 1e-7); assert.equal(dsp.soundPlaying, true); assert.equal(dsp.playing, false);
  dsp.update({ soundPlaying: false, enabled: true });
  assert.ok(rms(render(dsp, .5).left.slice(-RATE / 10)) < 1e-6);
});

test('phoneme speech is bounded, capturable, and independent of paused motion', () => {
  const dsp = engine({ playing: false, sound: { voice: 1 } });
  const samples = Float32Array.from({ length: RATE }, (_, i) => Math.sin(i / RATE * Math.PI * 440) * .3);
  dsp.setAtlas(samples, RATE);
  assert.equal(dsp.speak([{ offset: 0, duration: .3, gain: 1 }]), true);
  const spoken = render(dsp, .6).left;
  assert.ok(rms(spoken.slice(0, RATE / 4)) > .005);
  assert.ok(rms(spoken.slice(-RATE / 10)) < 1e-6);
  assert.equal(dsp.time, 0);
  assert.ok(createRoachSpeechPlan('cockroach '.repeat(1000)).length <= 96);
});

test('the shared preset bank shapes actual KAL words and vowel coloring preserves the spoken source', async () => {
  const bytes = readFileSync(SPELLING_DIPHONE_ATLAS_URL); let atlas;
  for (let cursor = 12; cursor + 8 < bytes.length;) {
    const size = bytes.readUInt32LE(cursor + 4);
    if (bytes.toString('ascii', cursor, cursor + 4) === 'data') {
      atlas = Float32Array.from({ length: size / 2 }, (_, i) => bytes.readInt16LE(cursor + 8 + i * 2) / 32768); break;
    }
    cursor += 8 + size + size % 2;
  }
  assert.ok(atlas?.length > 100000);
  const text = "hi, I'm a cockroach and I live in your house";
  const pronunciations = await loadSpellingPronunciations(text, { fetcher: async (url) => ({ ok: true, text: () => readFileSync(url, 'utf8') }) });
  const phones = createRoachSpeechPlan(text, pronunciations);
  assert.ok(phones.length > 20);
  const duration = Math.ceil(phones.reduce((sum, phone) => sum + phone.duration, 0) / .72 + .5);
  function words(sound) {
    const dsp = engine({ playing: false, soundPlaying: false, mappings: [], sound });
    dsp.setAtlas(atlas, 16000); assert.equal(dsp.speak(phones), true);
    const output = render(dsp, duration).left;
    assert.ok(output.every(Number.isFinite)); assert.ok(peak(output) < .95); assert.ok(rms(output) > .006);
    assert.equal(dsp.time, 0); assert.equal(dsp.soundTime, 0);
    return output;
  }
  const presets = ROACH_SOUND_PRESETS.map((preset) => words(preset.sound));
  for (let i = 1; i < presets.length; i += 1) assert.ok(difference(presets[0], presets[i]) > .001, `${ROACH_SOUND_PRESETS[i].id} does not shape words`);
  assert.ok(difference(words({ vowel: 0 }), words({ vowel: 1 })) > .0001, 'vowel must affect spoken samples as well as synthesized drones');
});

test('replacing or muting speech releases the old phrase without reviving it on re-enable', () => {
  const dsp = engine({ playing: false, sound: { voice: 1 } });
  dsp.setAtlas(Float32Array.from({ length: RATE }, (_, i) => Math.sin(i * Math.PI * 2 * 190 / RATE) * .5), RATE);
  dsp.speak([{ offset: 0, duration: .6 }]); render(dsp, .1);
  dsp.speak([{ offset: .2, duration: .2 }]);
  assert.ok(dsp.pendingSpeech);
  render(dsp, .04); assert.equal(dsp.pendingSpeech, null);
  dsp.update({ enabled: false }); render(dsp, .4);
  dsp.update({ enabled: true });
  assert.ok(rms(render(dsp, .3).left) < 1e-6);
});

function runtimeFixture() {
  const contexts = []; let resolveModule;
  const moduleReady = new Promise((resolve) => { resolveModule = resolve; });
  class Node {
    constructor() { this.connections = []; this.gain = { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } }; }
    connect(target) { this.connections.push(target); }
    disconnect() { this.connections.length = 0; }
  }
  class Context {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = new Node(); this.resumeCount = 0;
      this.audioWorklet = { addModule: () => moduleReady }; contexts.push(this); }
    resume() { this.resumeCount += 1; this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { return new Node(); }
  }
  class Worklet extends Node {
    constructor() { super(); this.messages = []; this.port = { postMessage: (message) => this.messages.push(message), close() {} }; }
  }
  return { contexts, resolveModule, runtime: { AudioContext: Context, AudioWorkletNode: Worklet, performance: { now: () => 0 } } };
}

test('explicit Audio creates/resumes before module await; disable during startup cannot rearm', async () => {
  const fixture = runtimeFixture(); const audio = new RoachSynthAudio({ runtime: fixture.runtime });
  audio.update({ playing: true, soundPlaying: true, time: 4 }); audio.interact({ jointId: 'head', active: true, velocity: 1 });
  assert.equal(fixture.contexts.length, 0, 'direct interaction cannot silently create or arm audio');
  const start = audio.enable();
  assert.equal(fixture.contexts.length, 1); assert.equal(fixture.contexts[0].resumeCount, 1);
  audio.disable(); fixture.resolveModule();
  await assert.rejects(start, { name: 'AbortError' });
  assert.equal(audio.enabled, false); assert.equal(audio.state.playing, true);
  assert.equal(audio.master.gain.value, 0);
  await audio.enable(); assert.equal(audio.enabled, true);
  audio.interact({ jointId: 'head', active: true, velocity: 400 });
  assert.deepEqual(audio.node.messages.at(-1), { type: 'interact', interaction: { jointId: 'head', active: true, velocity: 1 } });
  fixture.contexts[0].currentTime = 2; assert.equal(audio.getTime(), 6);
  audio.update({ playing: false }); audio.update({ soundPlaying: false });
  assert.equal(audio.getState().soundPlaying, false);
  audio.update({ soundPlaying: true }); fixture.contexts[0].currentTime = 3;
  assert.equal(audio.getTime(), 6, 'Sound Play must not advance or restart the animation clock');
  assert.equal(audio.getState().soundPlaying, true);
  assert.equal(getSharedAudioOutputManager(fixture.runtime).connectionCount(), 1);
  audio.dispose(); assert.equal(fixture.contexts[0].state, 'closed');
  assert.equal(getSharedAudioOutputManager(fixture.runtime).connectionCount(), 0);
});

test('dispose during module loading closes the context and rejects late initialization', async () => {
  const fixture = runtimeFixture(); const audio = new RoachSynthAudio({ runtime: fixture.runtime });
  const start = audio.enable(); audio.dispose(); fixture.resolveModule();
  await assert.rejects(start, { name: 'AbortError' });
  assert.equal(audio.node, null); assert.equal(audio.ready, false);
  assert.equal(getSharedAudioOutputManager(fixture.runtime).connectionCount(), 0);
});
