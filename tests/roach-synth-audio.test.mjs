import assert from 'node:assert/strict';
import test from 'node:test';
import { RoachSynthDsp, ROACH_SOUND_DEFAULTS, ROACH_SOUND_PRESETS, ROACH_MOD_TARGETS, createDefaultRoachMappings } from '../src/roach-synth-dsp.js';
import { RoachSynthAudio, createRoachSpeechPlan } from '../src/roach-synth-audio.js';
import { ROACH_MOTION_PRESETS, createRoachSceneState, writeRoachSceneState } from '../src/roach-synth-motion.js';
import { getSharedAudioOutputManager } from '../src/audio-output-manager.js';

const labels = ['body', 'abdomen', 'head', 'neck', 'wing_covers', 'left_antenna', 'right_antenna'];
for (const side of ['left', 'right']) for (const leg of ['front', 'middle', 'hind']) {
  for (const segment of ['proximal', 'mid', 'distal']) labels.push(`${side}_${leg}_leg_${segment}`);
}
labels.push('left_front_foot', 'right_front_foot');
const joints = labels.map((name, i) => ({ id: `bone-${i}`, jointId: name, name,
  offset: { x: 0, y: 0, z: 0 }, motion: { enabled: false, axis: 'x', amplitude: 12, speed: .5 } }));
const RATE = 24000;
function engine(settings = {}) {
  const dsp = new RoachSynthDsp(RATE);
  dsp.update({ joints, mappings: createDefaultRoachMappings(joints), enabled: true, playing: true, ...settings });
  return dsp;
}
function render(dsp, seconds = .6, blockSize = 128) {
  const left = new Float32Array(Math.round(seconds * RATE)); const right = new Float32Array(left.length);
  for (let offset = 0; offset < left.length; offset += blockSize) dsp.render(left.subarray(offset, offset + blockSize), right.subarray(offset, offset + blockSize));
  return { left, right };
}
function rms(samples) { return Math.sqrt(samples.reduce((energy, value) => energy + value * value, 0) / Math.max(1, samples.length)); }
function difference(a, b) { return rms(a.map((value, i) => value - b[i])); }
function peak(samples) { return samples.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0); }

test('audio starts silent and has bounded release without stopping its transport clock', () => {
  assert.equal(peak(render(engine({ sound: { level: 0 } })).left), 0, 'zero master at first arm must not blip');
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
});

test('six mechanical layers produce independent signal; voice is reserved for words', () => {
  const levels = { hiss: 0, shell: 0, wing: 0, voice: 0, feet: 0, growl: 0, drone: 0 };
  for (const key of ['hiss', 'shell', 'wing', 'feet', 'growl', 'drone']) {
    const sound = { ...ROACH_SOUND_DEFAULTS, ...levels, [key]: 1 };
    const motion = { presetId: key === 'feet' || key === 'shell' ? 'side_run' : 'top_flight' };
    const output = render(engine({ sound, motion }), 1.2);
    assert.ok(rms(output.left) > .0001, `${key} has no independent signal`);
  }
  assert.equal(peak(render(engine({ sound: { ...levels, voice: 1 } })).left), 0, 'words level must not create a continuous vowel drone');
  const outputs = ROACH_SOUND_PRESETS.map(({ sound }) => render(engine({ sound }), .9).left);
  for (const output of outputs) {
    assert.ok(output.every(Number.isFinite)); assert.ok(peak(output) < .99);
    assert.ok(rms(output) > .0008);
  }
  for (let i = 1; i < outputs.length; i += 1) assert.ok(difference(outputs[0], outputs[i]) > .001);
});

test('all 27 joints have editable defaults and each modulation target changes actual output', () => {
  const defaults = createDefaultRoachMappings(joints);
  assert.equal(defaults.length, 27); assert.equal(new Set(defaults.map(({ jointId }) => jointId)).size, 27);
  assert.equal(defaults[2].target, 'percussion'); assert.equal(defaults[4].target, 'wingRate');
  assert.equal(defaults[7].target, 'filter');
  for (const { id } of ROACH_MOD_TARGETS) {
    const outputs = [-1, 1].map((amount) => {
      const dsp = engine({ joints: joints.map((joint, i) => i ? joint : { ...joint, offset: { x: 28, y: 0, z: 0 } }),
        mappings: [{ jointId: joints[0].id, source: 'x', target: id, amount }],
        motion: { presetId: id === 'wingRate' ? 'top_flight' : 'side_run' },
        sound: { hiss: 1, shell: 1, feet: 1, wing: 1, growl: 1, drone: .6, voice: 1 } });
      if (id === 'voice') {
        dsp.setAtlas(Float32Array.from({ length: RATE }, (_, i) => Math.sin(i / RATE * Math.PI * 440) * .3), RATE);
        dsp.speak([{ offset: 0, duration: .6, gain: 1 }]);
      }
      return render(dsp, .9).left;
    });
    assert.ok(difference(...outputs) > .00001, `${id} mapping does not alter the signal`);
  }
});

test('armed paused direct manipulation excites leg, head, wing and antenna without moving the clock', () => {
  for (const index of [7, 2, 4, 5]) {
    const dsp = engine({ playing: false });
    assert.equal(peak(render(dsp, .2).left), 0);
    const retained = dsp.joints[index];
    dsp.interact({ jointId: joints[index].id, active: true });
    assert.equal(peak(render(dsp, .05).left), 0, 'selection alone must not make a sound');
    let strongest = 0;
    for (let gesture = 1; gesture <= 4; gesture += 1) {
      dsp.update({ joints: joints.map((joint, i) => i === index ? { ...joint, offset: { x: gesture * 8, y: gesture * 3, z: 0 } } : joint) });
      strongest = Math.max(strongest, rms(render(dsp, .035).left));
    }
    assert.equal(dsp.joints[index], retained, 'same-joint edits preserve identity and the previous-pose cache');
    assert.ok(strongest > .0003, `${joints[index].name} drag is inaudible`);
    assert.ok(dsp.telemetry.interactionPeak >= strongest, 'gesture peak captures actual short transients between telemetry reports');
    assert.equal(dsp.time, 0);
    dsp.interact({ jointId: joints[index].id, active: false });
    const released = render(dsp, 1).left;
    assert.ok(rms(released.slice(-RATE / 10)) < 1e-6, 'held geometry must settle after dragging stops');
    dsp.update({ enabled: false });
    dsp.update({ joints: joints.map((joint, i) => i === index ? { ...joint, offset: { x: -45, y: 0, z: 0 } } : joint) });
    assert.ok(rms(render(dsp, .4).left) < 1e-6);
  }
});

test('grounding calibration is preserved as a neutral sound baseline', () => {
  const settings = { playing: false, motion: { presetId: 'none', antennae: false }, sound: { drone: .6 } };
  const plain = engine(settings);
  const grounded = engine({ ...settings, joints: joints.map((joint) => ({ ...joint, restOffset: { x: 75, y: -35, z: 44 } })) });
  assert.equal(grounded.joints[7].restOffset.x, 75);
  const gaitPose = { back: [-10, 20, 30], front: [10, -20, 30], raisedBack: [-30, 15, 35], raisedFront: [30, -15, 35] };
  const calibrated = engine({ ...settings, joints: joints.map((joint, i) => i === 7 ? { ...joint, gaitPose } : joint) });
  assert.deepEqual(calibrated.joints[7].gaitPose, gaitPose);
  assert.notEqual(calibrated.joints[7].gaitPose.front, gaitPose.front, 'the audio state owns its calibration arrays');
  assert.deepEqual(render(plain, .4).left, render(grounded, .4).left, 'neutral ground pose must not bias any mapped parameter');
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

test('all 24 animation patches respond and factory sound has a rhythmic transient envelope', () => {
  assert.equal(ROACH_MOTION_PRESETS.length, 24);
  const signatures = [];
  for (const preset of ROACH_MOTION_PRESETS) {
    const output = render(engine({ motion: { presetId: preset.id } }), 1.2).left;
    assert.ok(output.every(Number.isFinite)); assert.ok(peak(output) < 1);
    assert.ok(rms(output) > .00001, `${preset.id} has no motion-to-sound response`);
    signatures.push(output);
  }
  const distinct = signatures.filter((output, i) => signatures.slice(0, i).every((other) => difference(output, other) > .00001));
  assert.equal(distinct.length, 24);
  const output = render(engine({ motion: { presetId: 'side_walk' } }), 2).left;
  const levels = [];
  for (let i = 0; i < output.length; i += RATE / 100) levels.push(rms(output.slice(i, i + RATE / 100)));
  levels.sort((a, b) => a - b);
  assert.ok(levels[Math.floor(levels.length * .9)] > levels[Math.floor(levels.length * .2)] * 5, 'contact accents should rise clearly above motion texture');
});

test('explicit drone can sustain while animation is paused and fades when its own level is removed', () => {
  const dsp = engine({ playing: false, sound: { drone: .6 } });
  assert.ok(rms(render(dsp, .6).left) > .001);
  dsp.update({ sound: { drone: 0 } });
  assert.ok(rms(render(dsp, 1).left.slice(-RATE / 10)) < 1e-6);
  assert.equal(dsp.time, 0);
});

test('live edits preserve phase and remain bounded with hostile parameters and mapping counts', () => {
  const dsp = engine(); render(dsp, .2); const time = dsp.time;
  dsp.update({ sound: { pitch: Infinity, resonance: NaN, crunch: 500, level: 8, pan: -500 },
    mappings: Array.from({ length: 500 }, () => ({ jointId: joints[0].id, source: 'xyz', target: 'pitch', amount: 1e9 })) });
  assert.equal(dsp.time, time); assert.ok(dsp.mappings.length <= 96);
  const output = render(dsp, .8);
  assert.ok(output.left.every(Number.isFinite)); assert.ok(output.right.every(Number.isFinite));
  assert.ok(peak(output.left) < 1); assert.ok(rms(output.right.slice(-2000)) < rms(output.left.slice(-2000)) * .001);
});

test('fast patch changes and all level extremes retain time and bounded output', () => {
  const dsp = engine(); let expected = 0;
  for (let i = 0; i < ROACH_MOTION_PRESETS.length; i += 1) {
    const loud = i % 2 === 0;
    dsp.update({ motion: { presetId: ROACH_MOTION_PRESETS[i].id, tempo: 240, intensity: 2 },
      sound: { level: .8, hiss: 1, shell: 1, wing: 1, voice: 1, feet: 1, growl: 1, drone: loud ? 1 : 0,
        pitch: loud ? 600 : 60, brightness: loud ? 1 : 0, resonance: 1, crunch: 1, rhythm: 4 } });
    assert.ok(Math.abs(dsp.time - expected) < 1e-7);
    const output = render(dsp, .125);
    assert.ok(output.left.every(Number.isFinite)); assert.ok(output.right.every(Number.isFinite));
    assert.ok(peak(output.left) < .99); assert.ok(peak(output.right) < .99);
    expected += .125;
  }
  dsp.update({ enabled: false });
  assert.ok(rms(render(dsp, .75).left.slice(-RATE / 10)) < 1e-7);
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
  audio.update({ playing: true, time: 4 }); audio.interact({ jointId: 'head', active: true, velocity: 1 });
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
