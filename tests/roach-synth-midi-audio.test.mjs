import assert from 'node:assert/strict';
import test from 'node:test';
import { RoachSynthDsp, createDefaultRoachBodyMix, ROACH_BODY_SOURCES } from '../src/roach-synth-dsp.js';
import { RoachSynthAudio } from '../src/roach-synth-audio.js';

const GROUPS = ['legs', 'covers', 'hindwings', 'thorax', 'abdomen', 'neck', 'head', 'antennae'];
const IDS = ['front_left', 'front_right', 'wing_cover_left', 'wing_cover_right', 'wing_hind_left', 'wing_hind_right', 'thorax', 'abdomen', 'neck', 'head', 'antenna_left', 'antenna_right'];
const JOINTS = IDS.map(id => ({ id, jointId: id, name: id, offset: { x: 0, y: 0, z: 0 } }));
const note = (number = 69, velocity = 100, extra = {}) => ({ type: 'noteOn', note: number, velocity, sourceId: 'keys', channel: 0, ...extra });
const off = (number = 69, extra = {}) => ({ ...note(number, 0, extra), type: 'noteOff' });
const cc = (controller, value, extra = {}) => ({ type: 'controlChange', controller, value, sourceId: 'keys', channel: 0, ...extra });
function mix(group = 'head', source = 'sine') {
  return createDefaultRoachBodyMix().map(row => ({ ...row, source, level: group === '*' || row.groupId === group ? .8 : 0 }));
}
function synth(options = {}) {
  const dsp = new RoachSynthDsp(24000);
  dsp.update({ enabled: true, playing: false, soundPlaying: false, joints: JOINTS, mappings: [],
    bodyMix: mix(), motion: { presetId: 'none', antennae: false, intensity: 1, tempo: 120 },
    sound: { pitch: 140, crunch: 0, level: .65, brightness: .75 }, ...options });
  return dsp;
}
function render(dsp, seconds, time) {
  const left = new Float32Array(Math.round(dsp.sampleRate * seconds)); const right = new Float32Array(left.length);
  const telemetry = structuredClone(dsp.render(left, right, time));
  let energy = 0; let peak = 0;
  for (let i = 0; i < left.length; i++) {
    assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
    energy += (left[i] ** 2 + right[i] ** 2) / 2; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  return { left, right, rms: Math.sqrt(energy / left.length), peak, telemetry };
}
function frequency(samples, rate) {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  return crossings * rate / samples.length;
}
function adapter({ pending = false } = {}) {
  let resolveModule; let now = 5000;
  const contexts = []; const messages = [];
  const module = pending ? new Promise(resolve => { resolveModule = resolve; }) : Promise.resolve();
  class Node {
    constructor() { this.gain = { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } }; }
    connect() {} disconnect() {}
  }
  class Context {
    constructor() { this.currentTime = 0; this.state = 'suspended'; this.destination = new Node(); this.audioWorklet = { addModule: () => module }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createGain() { return new Node(); }
  }
  class Worklet extends Node {
    constructor() {
      super(); this.dsp = new RoachSynthDsp(24000);
      this.port = { close() {}, postMessage: message => {
        messages.push(structuredClone(message));
        if (message.type === 'state') this.dsp.update(message.state);
        else if (message.type === 'midi') this.dsp.midi(message.message, message.audioTime);
        else if (message.type === 'midi-control') this.dsp.midiControl(message.groupId, message.axis, message.value, message.audioTime, message.scope);
        else if (message.type === 'midi-reset') this.dsp.resetMidi(message.scope, message.audioTime);
        else if (message.type === 'midi-state') this.dsp.restoreMidi(message.snapshot);
      } };
    }
  }
  return { contexts, messages, finish: () => resolveModule?.(), setNow: value => { now = value; }, runtime: {
    AudioContext: Context, AudioWorkletNode: Worklet, performance: { now: () => now }, fetch: async () => ({ ok: false }),
  } };
}

test('a held body note uses its selected source on the sample clock without starting either player', () => {
  const dsp = synth(); assert.equal(render(dsp, .1).peak, 0);
  dsp.midi(note()); render(dsp, .25); const firstPose = dsp.pose.slice(); const sounding = render(dsp, .35);
  assert.ok(sounding.rms > .025); assert.equal(dsp.time, 0); assert.equal(dsp.soundTime, 0);
  assert.deepEqual(dsp.pose, firstPose, 'a held key holds a pose instead of starting an animation');
  assert.ok(firstPose.some(value => Math.abs(value) > 1), 'the key creates a visibly different held pose');
  assert.equal(sounding.telemetry.midiActive, 1); assert.equal(sounding.telemetry.midiNotes[6], 69);
  assert.equal(sounding.telemetry.midiFrequencies[6], 440);
  assert.ok(Math.abs(frequency(sounding.left, dsp.sampleRate) - 440) < 12);
  assert.ok(dsp.body.voices[6].midiGate > .75);
  assert.equal(dsp.body.voices[0].midiGate, 0);
  dsp.midi(off()); render(dsp, 1); assert.ok(render(dsp, .1).peak < 1e-6);
});

test('velocity, bend, expression and pressure affect the owned voice rather than global sound controls', () => {
  const quiet = synth(); quiet.midi(note(69, 32)); render(quiet, .3); const low = render(quiet, .25);
  const loud = synth(); loud.midi(note(69, 112)); render(loud, .3); const high = render(loud, .25);
  assert.ok(high.rms > low.rms * 2, `${low.rms} -> ${high.rms}`);
  assert.ok(high.telemetry.midiGates[6] > low.telemetry.midiGates[6] * 2);
  loud.midi({ type: 'pitchBend', normalized: 1, sourceId: 'keys', channel: 0 }); render(loud, .3); const bent = render(loud, .25);
  assert.ok(Math.abs(bent.telemetry.midiFrequencies[6] / 440 - 2 ** (2 / 12)) < 1e-10);
  assert.ok(frequency(bent.left, loud.sampleRate) > frequency(high.left, loud.sampleRate) * 1.1);
  assert.equal(loud.sound.pitch, 140);
  loud.midi(cc(11, 0)); render(loud, .8); assert.ok(render(loud, .15).peak < 1e-5);
  loud.midi(cc(11, 127)); render(loud, .3); assert.ok(render(loud, .15).rms > .025);
  quiet.midi({ type: 'channelPressure', pressure: 127, sourceId: 'keys', channel: 0 }); render(quiet, .3);
  assert.ok(quiet.body.voices[6].midiGate > low.telemetry.midiGates[6] * 1.2);
});

test('body mix mute, per-group polyphony and source/channel panic remain independent of manual players', () => {
  const dsp = synth({ bodyMix: mix('*') });
  for (const number of [60, 62, 64, 66, 67, 68, 69, 70]) dsp.midi(note(number, 100, { sourceId: number === 69 ? 'other' : 'keys' }));
  render(dsp, .3); assert.equal(dsp.telemetry.midiActive, 8);
  dsp.resetMidi({ sourceId: 'keys' }); render(dsp, .8);
  assert.equal(dsp.telemetry.midiActive, 1); assert.equal(dsp.telemetry.midiNotes[6], 69);
  assert.ok(render(dsp, .2).rms > .025);
  dsp.update({ bodyMix: mix('none') }); render(dsp, .5); assert.ok(render(dsp, .2).peak < 1e-7);
  dsp.update({ bodyMix: mix('neck'), soundPlaying: true }); dsp.resetMidi(); render(dsp, .5);
  assert.ok(render(dsp, .2).rms > .02); assert.equal(dsp.soundPlaying, true); assert.equal(dsp.playing, false);
});

test('sustain holds only its source/channel, and source disconnect clears all its channels', () => {
  const dsp = synth(); dsp.midi(note()); dsp.midi(cc(64, 127)); dsp.midi(off()); render(dsp, .5);
  assert.ok(render(dsp, .2).rms > .025);
  dsp.midi(cc(64, 0, { channel: 1 })); render(dsp, .3); assert.equal(dsp.telemetry.midiActive, 1);
  dsp.midi(cc(64, 0)); render(dsp, 1); assert.ok(render(dsp, .1).peak < 1e-6);
  dsp.midi(note(69, 100, { channel: 0 })); dsp.midi(note(81, 100, { channel: 1 })); render(dsp, .3);
  dsp.midi(cc(120, 0, { synthetic: true, reason: 'disconnect' })); render(dsp, 1);
  assert.equal(dsp.telemetry.midiActive, 0); assert.ok(render(dsp, .1).peak < 1e-6);
});

test('MIDI legs excite the actual selected percussion, then release without autonomous idle hits', () => {
  for (const source of ['footsteps', 'click', 'clack', 'fm', 'rattle', 'pluck']) {
    const dsp = synth({ bodyMix: mix('legs', source) }); dsp.midi(note(60));
    const first = render(dsp, .15); const attacks = dsp.body.voices[0].percussion.events;
    assert.ok(first.peak > .004, source); assert.equal(dsp.midiEvents, 1);
    render(dsp, 1.3); const held = render(dsp, .15);
    assert.ok(held.peak < 1e-6, `${source} must decay while its key is still held: ${held.peak}`);
    assert.equal(dsp.body.voices[0].percussion.events, attacks, 'settled keys cannot schedule more strikes');
    assert.equal(dsp.telemetry.midiNotes[0], 60);
    dsp.midi(off(60)); render(dsp, 1.6); const stopped = render(dsp, .15);
    assert.ok(stopped.peak < 1e-6, `${source}: ${stopped.peak}`);
    assert.equal(dsp.time, 0);
  }
});

test('CC XYZ overlays share the control pose and movement releases once the control is stationary', () => {
  for (const axis of ['x', 'y', 'z']) {
    const dsp = synth({ bodyMix: mix('head', 'walls') }); render(dsp, .05);
    assert.ok(dsp.midiControl('head', axis, .8, dsp.audioTime, { sourceId: 'keys', channel: 0 }));
    assert.ok(render(dsp, .2).peak > .004, axis);
    const index = IDS.indexOf('head') * 3 + ['x', 'y', 'z'].indexOf(axis);
    assert.ok(Math.abs(dsp.pose[index]) > 10); assert.equal(dsp.joints[IDS.indexOf('head')].offset[axis], 0);
    render(dsp, .8); assert.ok(render(dsp, .15).peak < 1e-6);
    dsp.midi(cc(121, 0)); render(dsp, .6); assert.ok(Math.abs(dsp.pose[index]) < .001);
  }
});

test('MIDI messages cannot arm Audio and adapter owns one clock-matched visual mirror', async () => {
  const f = adapter(); const audio = new RoachSynthAudio({ runtime: f.runtime });
  try {
    audio.update({ joints: JOINTS, mappings: [], bodyMix: mix(), motion: { presetId: 'none', antennae: false, intensity: 1 } });
    assert.ok(audio.midi(note())); assert.equal(f.contexts.length, 0); assert.equal(audio.enabled, false);
    f.setNow(5150); assert.equal(audio.getMidiState().heldCount, 1);
    const before = new Float32Array(JOINTS.length * 3); audio.applyMidiPose(before, JOINTS);
    await audio.enable(); const after = new Float32Array(before.length); audio.applyMidiPose(after, JOINTS);
    assert.deepEqual(after, before, 'first context adoption preserves the visible note phase');
    const dsp = audio.node.dsp; assert.ok(render(dsp, .35, 0).rms > .01);
    assert.equal(audio.state.playing, false); assert.equal(audio.state.soundPlaying, false);
    f.contexts[0].currentTime = .35; audio.midi(off()); render(dsp, 1, .35); assert.ok(render(dsp, .15).peak < 1e-6);
    audio.disable(); assert.equal(audio.getMidiState().heldCount, 0);
  } finally { audio.dispose(); }
});

test('notes received during worklet loading restore held ownership without replaying released attacks', async () => {
  const f = adapter({ pending: true }); const audio = new RoachSynthAudio({ runtime: f.runtime });
  try {
    const ready = audio.enable({ joints: JOINTS, mappings: [], bodyMix: mix('*'), motion: { presetId: 'none', antennae: false } });
    f.contexts[0].currentTime = .1; audio.midi(note(60)); audio.midi(note(69));
    f.contexts[0].currentTime = .12; audio.midi(off(60));
    f.contexts[0].currentTime = .4; f.finish(); await ready;
    const dsp = audio.node.dsp; const output = render(dsp, .2, .4);
    assert.equal(output.telemetry.midiActive, 1); assert.equal(output.telemetry.midiNotes[6], 69);
    assert.equal(dsp.midiEvents, 0, 'snapshot restoration never replays past attacks');
    assert.ok(output.rms > .01);
    f.contexts[0].currentTime = .6; audio.disable(); render(dsp, .8, .6); assert.ok(render(dsp, .1).peak < 1e-6);
    assert.equal(audio.getMidiState().heldCount, 1, 'Audio mute preserves held visual ownership');
    f.contexts[0].currentTime = 1.5; audio.midi(off(69)); render(dsp, .3, 1.5);
    f.contexts[0].currentTime = 1.8; await audio.enable();
    const rearm = render(dsp, .2, 1.8); assert.ok(rearm.peak < .001, `only the quiet existing release tail may remain: ${rearm.peak}`);
    assert.equal(dsp.midiEvents, 0); assert.ok(render(dsp, .15).peak < 1e-6);
  } finally { audio.dispose(); }
});

test('future note attacks wait for the audio clock and stale released notes cannot revive', () => {
  const dsp = synth({ bodyMix: mix('legs', 'click') }); dsp.midi(note(60), .2);
  assert.equal(render(dsp, .15, 0).peak, 0); assert.equal(dsp.midiEvents, 0);
  assert.ok(render(dsp, .15).peak > .004); assert.equal(dsp.midiEvents, 1);
  dsp.resetMidi(); render(dsp, 1);
  dsp.midi(note(60), dsp.audioTime - .2); dsp.midi(off(60), dsp.audioTime - .19);
  assert.ok(render(dsp, .2).peak < 1e-6); assert.equal(dsp.midiEvents, 1);
});

test('the fixed MIDI record/voice pools and output guard bound hostile multi-note controls', () => {
  const dsp = synth({ bodyMix: mix('*', 'rattle'), sound: { level: 1, pitch: 800, crunch: 1, resonance: .98 } });
  for (let i = 0; i < 80; i++) dsp.midi(note(i + 24, 999, { sourceId: `source-${i % 5}`, channel: i % 16 }));
  assert.equal(dsp.midiPerformance.voices.length, 24); assert.equal(dsp.body.voices.length, 8);
  for (const group of GROUPS) for (const axis of ['x', 'y', 'z']) dsp.midiControl(group, axis, 999);
  const output = render(dsp, .5); assert.ok(output.peak <= .95); assert.ok(output.peak > .01);
  dsp.update({ enabled: false }); render(dsp, 1); assert.ok(render(dsp, .1).peak < 1e-6);
  dsp.resetMidi(); render(dsp, .3); dsp.update({ enabled: true }); const rearmed = render(dsp, .15); assert.ok(rearmed.peak < 1e-6, `rearm cannot replay disposed MIDI notes: ${rearmed.peak}`);
});


test('incoming All Sound Off cannot mistake a removed note overlay for a new physical attack', () => {
  const dsp = synth({ bodyMix: mix('*', 'rustle') });
  const samples = new Float32Array(24000); for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * .47) * .1;
  dsp.setSampleBank(['vivarium_scuttle', 'vivarium_rustle', 'vivarium_contact'].map(id => ({ id, data: samples, sampleRate: 24000, cues: [0] })));
  dsp.midi(note(69)); render(dsp, .17); const events = dsp.recordings.events;
  assert.ok(events > 0); dsp.midi(cc(120, 0)); render(dsp, .05);
  assert.equal(dsp.recordings.events, events, 'panic must not trigger return-to-neutral rustle');
  render(dsp, .8); assert.ok(render(dsp, .1).peak < 1e-6);
});


test('adapter preserves MIDI timestamps across a UI stall and never schedules future releases', async () => {
  const f = adapter(); const audio = new RoachSynthAudio({ runtime: f.runtime });
  try {
    await audio.enable({ joints: JOINTS, mappings: [], bodyMix: mix('legs', 'click'), motion: { presetId: 'none', antennae: false } });
    f.contexts[0].currentTime = 1; f.setNow(6000); const dsp = audio.node.dsp; render(dsp, .01, 1);
    audio.midi(note(60, 100, { timestamp: 5500 })); audio.midi(off(60, { timestamp: 5520 }));
    assert.equal(f.messages.at(-2).audioTime, .5); assert.equal(f.messages.at(-1).audioTime, .52);
    const stale = render(dsp, .15, 1.01); assert.equal(stale.peak, 0); assert.equal(dsp.midiEvents, 0);
    audio.midi(note(69, 100, { timestamp: 6000 }));
    audio.midi(off(69, { timestamp: 9000 }));
    assert.equal(f.messages.at(-1).audioTime, 1, 'future input timestamps cannot defer a safety release');
  } finally { audio.dispose(); }
});


test('disposal clears retained visual MIDI ownership even though Audio Off preserves it', () => {
  const f = adapter(); const audio = new RoachSynthAudio({ runtime: f.runtime });
  audio.midi(note()); audio.disable(); assert.equal(audio.getMidiState().heldCount, 1);
  audio.dispose(); assert.equal(audio.getMidiState().heldCount, 0);
  assert.equal(audio.midi(note()), false); assert.equal(f.contexts.length, 0);
});


test('different keys create distinct held geometry and pitch without changing Animation Play', () => {
  const dsp = synth(); dsp.midi(note(69)); render(dsp, .3);
  const first = render(dsp, .2); const firstPose = dsp.pose.slice();
  dsp.midi(note(81)); render(dsp, .3); const second = render(dsp, .2);
  assert.notDeepEqual(dsp.pose, firstPose, 'octave changes remain visible within the same body group');
  assert.ok(frequency(second.left, dsp.sampleRate) / frequency(first.left, dsp.sampleRate) > 1.85);
  assert.equal(dsp.playing, false); assert.equal(dsp.time, 0);
  dsp.update({ playing: true, motion: { presetId: 'side_walk' } }); render(dsp, .3);
  const started = dsp.time; const contacts = dsp.contactEvents;
  dsp.midi(off(81)); render(dsp, .3); assert.ok(dsp.time > started + .29); assert.ok(dsp.contactEvents > contacts);
  dsp.resetMidi(); assert.equal(dsp.playing, true);
  dsp.update({ playing: false }); const paused = dsp.time; dsp.midi(note(69)); render(dsp, .5);
  assert.equal(dsp.time, paused); const settled = dsp.pose.slice(); render(dsp, .3); assert.deepEqual(dsp.pose, settled);
});

test('all movement-only body sources become quiet after the keyboard pose settles', () => {
  for (const { id, motionOnly } of ROACH_BODY_SOURCES) {
    if (!motionOnly) continue;
    const dsp = synth({ bodyMix: mix('head', id) });
    if (id === 'rustle') {
      const data = new Float32Array(24000); for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * .47) * .1;
      dsp.setSampleBank(['vivarium_scuttle', 'vivarium_rustle', 'vivarium_contact'].map(sampleId => ({ id: sampleId, data, sampleRate: 24000, cues: [0] })));
    }
    dsp.midi(note(69)); const onset = render(dsp, .2); assert.ok(onset.peak > .001, id);
    const pose = dsp.pose.slice(); const events = dsp.recordings.events;
    render(dsp, 1.4); const held = render(dsp, .2);
    assert.deepEqual(dsp.pose, pose, id); assert.equal(dsp.recordings.events, events, id);
    assert.ok(held.peak < 1e-6, `${id} must not turn held notes into automatic repeated motion: ${held.peak}`);
    assert.equal(dsp.telemetry.midiNotes[6], 69);
  }
});
