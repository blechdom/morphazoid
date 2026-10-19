import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { WitchAudio } from '../src/instruments/witch/witch-audio.js';
import { WITCH_VOCAL_EFFECTS, WITCH_FLIGHT_EFFECTS, WITCH_FINGER_SOURCES, WITCH_LAUNCH_DURATION, WITCH_VOICES } from '../src/instruments/witch/witch-model.js';
import { HandDSP } from '../src/instruments/gesticulating-hand/hand-dsp.js';
import { getSharedAudioOutputManager } from '../src/audio-output-manager.js';

const RATE = 24000;
const rms = data => Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
const difference = (a, b) => Math.sqrt(a.reduce((sum, sample, i) => sum + (sample - b[i]) ** 2, 0) / a.length);
function render(dsp, seconds = 1, blockSize = 128) {
  const data = new Float32Array(Math.round(seconds * dsp.rate));
  for (let offset = 0; offset < data.length; offset += blockSize) dsp.process(data.subarray(offset, Math.min(offset + blockSize, data.length)));
  return data;
}
function playing(controls = {}) {
  const dsp = new WitchDSP(RATE); dsp.setControls({ gate: true, speed: .55, radius: .65, ...controls }); dsp.setEnabled(true);
  return dsp;
}

test('unarmed gestures remain exactly silent; all voice characters are bounded and distinct', () => {
  const off = new WitchDSP(RATE); off.setControls({ gate: true, speed: 1 });
  assert.equal(rms(render(off)), 0); assert.equal(off.trigger('moan'), false);
  const voices = WITCH_VOICES.map(voice => render(playing({ voice })));
  for (let i = 0; i < voices.length; i++) {
    assert.ok(rms(voices[i]) > .015, WITCH_VOICES[i]);
    for (const value of voices[i]) assert.ok(Number.isFinite(value) && Math.abs(value) <= .54);
    for (let j = 0; j < i; j++) assert.ok(difference(voices[i], voices[j]) > .025, `${WITCH_VOICES[i]} / ${WITCH_VOICES[j]}`);
  }
});

test('release coasts, produces a causal breath, and decays without further controls', () => {
  const dsp = playing(); render(dsp, .8);
  const initial = dsp.visual.speed;
  dsp.setControls({ gate: false });
  const tail = render(dsp, .15);
  assert.ok(rms(tail) > .005); assert.ok(dsp.visual.breath > .3);
  assert.ok(dsp.visual.speed < initial && dsp.visual.speed > initial * .8);
  render(dsp, 5.85);
  assert.ok(rms(render(dsp, .3)) < .00001);
  assert.ok(dsp.visual.speed < .006);
});

test('stalled UI and different render block sizes preserve exact audio-clock synthesis', () => {
  const a = playing({ mode: 'flight', speed: .85 }), b = playing({ mode: 'flight', speed: .85 });
  const uninterrupted = render(a, 5, 128);
  const singleCall = render(b, 5, RATE * 5);
  assert.deepEqual(uninterrupted, singleCall);
  assert.equal(a.effectCounter, b.effectCounter); assert.ok(a.effectCounter > 0);
  assert.equal(a.visual.chantPhase, b.visual.chantPhase);
  assert.ok(Math.abs(a.visual.audioTime - 5) < 1e-9);
});

test('stir speed accelerates articulation; reverse retraces syllable and vortex direction', () => {
  const slow = playing({ speed: .1 }), fast = playing({ speed: .9 });
  render(slow, 1); render(fast, 1);
  assert.ok(fast.visual.chantPhase > slow.visual.chantPhase * 3);
  const before = fast.visual.chantPhase;
  fast.setControls({ direction: -1 }); render(fast, .2);
  assert.ok(fast.visual.chantPhase < before); assert.equal(fast.visual.direction, -1);
});

test('phase alignment joins silent motion without restarting a vocal phrase or arming audio', () => {
  const dsp = playing(); render(dsp, .5);
  const phrase = dsp.chantPhase; dsp.syncPhase(2.4, .62);
  assert.equal(dsp.chantPhase, phrase); assert.ok(Math.abs(dsp.visual.phase - 2.4) < 1e-12);
  assert.equal(dsp.visual.speed, .62);
  const { runtime, calls } = fakeRuntime(), audio = new WitchAudio(runtime);
  audio.syncPhase(2.4, .62);
  assert.equal(calls.contexts, 0); assert.equal(audio.audible, false);
  assert.equal(audio.visual.speed, .62);
});

test('each finger and both ingredients alter the exact DSP output', () => {
  const reference = render(playing({ voice: 'sing' }));
  for (let index = 0; index < 5; index++) {
    const fingers = [.5, .5, .5, .5, .5]; fingers[index] = 1;
    assert.ok(difference(reference, render(playing({ voice: 'sing', fingers }))) > .015, `finger ${index}`);
  }
  for (const controls of [{ radius: 0 }, { glass: 1 }, { hair: 1 }, { mode: 'flight', altitude: 1 }]) {
    assert.ok(difference(reference, render(playing({ voice: 'sing', ...controls }))) > .012, JSON.stringify(controls));
  }
});

test('cauldron vocal effects sound from a closed gate, finish, and have bounded polyphony', () => {
  const buffers = [];
  for (const kind of WITCH_VOCAL_EFFECTS) {
    const dsp = new WitchDSP(RATE); dsp.setEnabled(true);
    assert.equal(dsp.trigger(kind), true);
    const sound = render(dsp, 1); buffers.push(sound);
    assert.ok(rms(sound) > .005, kind);
    render(dsp, 4); assert.ok(rms(render(dsp, .2)) < .000001, `${kind} ends`);
  }
  for (let i = 1; i < buffers.length; i++) assert.ok(difference(buffers[0], buffers[i]) > .02);
  const dsp = playing({ speed: 1, glass: 1, hair: 1, fingers: [1, 1, 1, 1, 1] });
  for (let i = 0; i < 1000; i++) dsp.trigger(WITCH_VOCAL_EFFECTS[i % 5]);
  assert.equal(dsp.effects.length, 4);
  for (const value of render(dsp, 2)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .54);
});

test('fingers reuse Gesticules with five isolated nonvocal sources and independent gates', () => {
  const signals = [];
  for (let finger = 0; finger < 5; finger++) {
    const dsp = playing({ mode: 'fingers', fingerMask: 1 << finger });
    assert.ok(dsp.hand instanceof HandDSP);
    signals.push(render(dsp, .35));
    assert.deepEqual(dsp.hand.voices.map(v => v.source), WITCH_FINGER_SOURCES);
    assert.ok(rms(signals[finger]) > .007);
    assert.equal(dsp.visual.mouth, 0); assert.equal(dsp.visual.breath, 0);
    for (let i = 0; i < 5; i++) assert.equal(dsp.visual.fingerLevels[i] > .1, i === finger);
    dsp.setControls({ gate: false, fingerMask: 0 }); render(dsp, 2);
    assert.ok(rms(render(dsp, .2)) < .000001, `finger ${finger} releases`);
  }
  for (let i = 0; i < 5; i++) for (let j = 0; j < i; j++) assert.ok(difference(signals[i], signals[j]) > .008);
  const all = playing({ mode: 'fingers', fingerMask: 0 }); render(all, .2);
  assert.ok(all.visual.fingerLevels.every(level => level > .1));
  all.setControls({ fingerMask: 0b10101 }); render(all, .5);
  assert.deepEqual(all.visual.fingerLevels.map(level => level > .1), [true, false, true, false, true]);
});

test('each finger continuously bends its own material, and movement re-strikes mallets', () => {
  for (let finger = 0; finger < 5; finger++) {
    const low = Array(5).fill(.5), high = [...low]; low[finger] = .1; high[finger] = .9;
    const a = playing({ mode: 'fingers', fingerMask: 1 << finger, fingers: low });
    const b = playing({ mode: 'fingers', fingerMask: 1 << finger, fingers: high });
    const first = render(a, .35), second = render(b, .35);
    assert.ok(difference(first, second) > .008, `finger ${finger} pitch/tone destination`);
    assert.ok(b.hand.targets[finger].frequency > a.hand.targets[finger].frequency * 2);
    const held = playing({ mode: 'fingers', fingerMask: 1 << finger });
    const unrelated = [.5, .5, .5, .5, .5]; unrelated[(finger + 1) % 5] = 1;
    const other = playing({ mode: 'fingers', fingerMask: 1 << finger, fingers: unrelated });
    assert.deepEqual(render(held, .2), render(other, .2), 'unheld finger does not alter the held source');
    if (finger > 2) {
      render(a, 2); const quiet = rms(render(a, .1));
      a.setControls({ fingers: high });
      assert.ok(rms(render(a, .1)) > quiet * 2 + .001, 'moving a ringing material re-excites it');
    }
  }
});

test('instrumental scenes are completely independent of voice character and ingredients', () => {
  for (const mode of ['fingers', 'flight']) {
    const a = playing({ mode, voice: 'whisper', glass: 0, hair: 0 });
    const b = playing({ mode, voice: 'cackle', glass: 1, hair: 1 });
    assert.deepEqual(render(a, 1), render(b, 1), mode);
    assert.equal(a.visual.mouth, 0); assert.equal(b.visual.mouth, 0);
    for (const kind of ['cackle', 'moan', 'howl']) assert.equal(a.trigger(kind), false, `${mode} rejects ${kind}`);
  }
});

test('finger synthesis and flight music retain sample-clock timing through rendering stalls', () => {
  for (const mode of ['fingers', 'flight']) {
    const a = playing({ mode }), b = playing({ mode });
    assert.deepEqual(render(a, 1.2, 128), render(b, 1.2, 24000), mode);
    const lowTone = playing({ mode, tone: .05 }), highTone = playing({ mode, tone: .95 });
    assert.ok(difference(render(lowTone, .4), render(highTone, .4)) > .003, `${mode} tone`);
  }
  const slow = playing({ mode: 'fingers', speed: .05 }), fast = playing({ mode: 'fingers', speed: .95 });
  assert.deepEqual(render(slow, .5), render(fast, .5), 'finger performance does not require the flight/stir speed');
});

test('flight speed controls strikes, altitude bends pitch, and horizontal position controls stereo', () => {
  const slow = playing({ mode: 'flight', speed: .05 }), fast = playing({ mode: 'flight', speed: .95 });
  render(slow, 2); render(fast, 2);
  assert.ok(fast.flight.noteCount > slow.flight.noteCount * 3);
  assert.ok(fast.visual.flightPulse >= 0 && fast.visual.flightPulse <= 1);
  const low = playing({ mode: 'flight', altitude: .05 }), high = playing({ mode: 'flight', altitude: .95 });
  assert.ok(difference(render(low, .6), render(high, .6)) > .02);
  assert.ok(high.flight.rootHz > low.flight.rootHz * 4);
  for (const x of [0, 1]) {
    const dsp = playing({ mode: 'flight', flightX: x }); render(dsp, .3);
    const left = new Float32Array(RATE), right = new Float32Array(RATE); dsp.process(left, right);
    assert.ok(x === 0 ? rms(left) > rms(right) * 1.7 : rms(right) > rms(left) * 1.7);
  }
});

test('flight scenery produces bounded musical effects and releases with no vocal mouth', () => {
  const signals = [];
  for (const kind of WITCH_FLIGHT_EFFECTS.filter(kind => kind !== 'launch')) {
    const dsp = playing({ mode: 'flight', gate: false });
    assert.equal(dsp.trigger(kind), true); signals.push(render(dsp, 1));
    assert.ok(rms(signals.at(-1)) > .005, kind); assert.equal(dsp.visual.mouth, 0);
    render(dsp, 4); assert.ok(rms(render(dsp, .1)) < .000001, `${kind} ends`);
  }
  for (let i = 1; i < signals.length; i++) assert.ok(difference(signals[0], signals[i]) > .015);
  const dsp = playing({ mode: 'flight' });
  for (let i = 0; i < 1000; i++) dsp.trigger(WITCH_FLIGHT_EFFECTS[i % 5]);
  assert.equal(dsp.flight.voices.length, 8);
  for (const value of render(dsp, 2)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .54);
  dsp.setControls({ gate: false }); render(dsp, 4);
  assert.ok(rms(render(dsp, .2)) < .000001);
});

test('takeoff cackle is an explicit bounded one-shot, then its output and mouth close completely', () => {
  const dsp = playing({ mode: 'flight', gate: false });
  assert.equal(dsp.trigger('launch'), true);
  const first = render(dsp, .2);
  assert.ok(rms(first) > .015);
  assert.ok(dsp.visual.launchEnvelope > .3 && dsp.visual.mouth > .3);
  assert.equal(dsp.visual.effect, 'launch');
  for (const value of render(dsp, WITCH_LAUNCH_DURATION)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .54);
  assert.equal(dsp.flight.launch.active, false);
  assert.equal(dsp.visual.launchEnvelope, 0); assert.equal(dsp.visual.mouth, 0);
  assert.equal(rms(render(dsp, .3)), 0, 'no voice or tail remains after the finite phrase');
});

test('takeoff does not alter or automatically repeat over the instrumental flight pattern', () => {
  const withLaunch = playing({ mode: 'flight' }), musicOnly = playing({ mode: 'flight' });
  withLaunch.trigger('launch');
  assert.ok(difference(render(withLaunch, .6), render(musicOnly, .6)) > .02);
  render(withLaunch, WITCH_LAUNCH_DURATION); render(musicOnly, WITCH_LAUNCH_DURATION);
  assert.deepEqual(render(withLaunch, 3), render(musicOnly, 3), 'music resumes bit-identically after the one-shot');
  assert.equal(withLaunch.visual.launchEnvelope, 0); assert.equal(withLaunch.visual.mouth, 0);
  assert.equal(withLaunch.flight.noteCount, musicOnly.flight.noteCount);
});

test('repeated and near-expiry launches reuse one voice and have one finite end', () => {
  const dsp = playing({ mode: 'flight', gate: false });
  dsp.trigger('launch'); render(dsp, .3);
  const voice = dsp.flight.launch;
  for (let i = 0; i < 1000; i++) assert.equal(dsp.trigger('launch'), true);
  for (const value of render(dsp, .04)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .54);
  assert.equal(dsp.flight.launch, voice); assert.equal(dsp.flight.voices.length, 8);
  assert.ok(voice.age < .04); assert.equal(voice.pending, false);
  render(dsp, WITCH_LAUNCH_DURATION - voice.age - .004);
  dsp.trigger('launch'); render(dsp, .025);
  assert.ok(voice.active && voice.age < .025, 'a takeoff near the previous expiry is preserved');
  render(dsp, WITCH_LAUNCH_DURATION + .1);
  assert.equal(voice.active, false); assert.equal(rms(render(dsp, .2)), 0);
});

test('muting or leaving flight cancels takeoff without stale voice on return', () => {
  const muted = playing({ mode: 'flight', gate: false }); muted.trigger('launch'); render(muted, .2);
  muted.setEnabled(false); assert.ok(rms(render(muted, .01)) > .0001, 'mute retains a short release');
  render(muted, .04); assert.equal(muted.flight.launch.active, false);
  assert.equal(muted.trigger('launch'), false);
  muted.setEnabled(true); assert.equal(rms(render(muted, .3)), 0);
  const changed = playing({ mode: 'flight', gate: false }); changed.trigger('launch'); render(changed, .2);
  changed.setControls({ mode: 'fingers' }); render(changed, .07);
  assert.equal(changed.visual.mouth, 0); assert.equal(changed.visual.launchEnvelope, 0);
  assert.equal(changed.trigger('launch'), false);
  changed.setControls({ mode: 'flight' }); assert.equal(rms(render(changed, .3)), 0);
  const cauldron = playing(); assert.equal(cauldron.trigger('launch'), false);
});

test('takeoff timing and syllables are unchanged by rendering stalls', () => {
  const a = playing({ mode: 'flight' }), b = playing({ mode: 'flight' });
  a.trigger('launch'); b.trigger('launch');
  assert.deepEqual(render(a, 2.2, 128), render(b, 2.2, RATE * 3));
  assert.equal(a.visual.launchEnvelope, 0); assert.equal(b.visual.launchEnvelope, 0);
});

test('scene changes completely remove previous vocals after their short crossfade', () => {
  for (const mode of ['fingers', 'flight']) {
    const a = playing({ voice: 'whisper' }), b = playing({ voice: 'sing' });
    render(a, .3); render(b, .3); a.trigger('cackle'); b.trigger('howl');
    a.setControls({ mode }); b.setControls({ mode });
    render(a, .06); render(b, .06);
    assert.equal(a.weights[0], 0); assert.equal(b.weights[0], 0);
    assert.deepEqual(render(a, .4), render(b, .4), `${mode} contains no earlier vocal tail`);
  }
  const interrupted = playing(); render(interrupted, .2);
  interrupted.setControls({ mode: 'fingers' }); render(interrupted, .02);
  interrupted.setControls({ mode: 'flight' }); render(interrupted, .01);
  assert.ok(Math.abs(interrupted.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12,
    'interrupting a crossfade keeps its summed gain');
});

test('every scene and queued effect mutes smoothly without lingering output', () => {
  for (const mode of ['brew', 'fingers', 'flight']) {
    const dsp = playing({ mode }); render(dsp, .4);
    if (mode !== 'fingers') dsp.trigger(mode === 'brew' ? 'howl' : 'moon');
    render(dsp, .1); dsp.setEnabled(false);
    assert.ok(rms(render(dsp, .02)) > .00001, `${mode} fades instead of abruptly zeroing`);
    render(dsp, 1); assert.ok(rms(render(dsp, .1)) < 1e-9, `${mode} stays muted`);
  }
});

test('audio-off releases smoothly and malformed live controls remain finite', () => {
  const dsp = playing(); render(dsp, .5); dsp.setEnabled(false);
  const fade = render(dsp, .05); assert.ok(rms(fade) > .0001);
  render(dsp, 1); assert.ok(rms(render(dsp, .1)) < 1e-10);
  dsp.setControls({ speed: NaN, radius: Infinity, fingers: [NaN, Infinity, -99], hair: 'bad', gate: true });
  dsp.setEnabled(true);
  for (const value of render(dsp, .5)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .54);
});

function fakeRuntime({ deferModule = false, failModule = false } = {}) {
  const calls = { contexts: 0, resumed: 0, modules: 0, closed: 0, messages: [], disconnected: 0 };
  let finishModule;
  const moduleReady = deferModule ? new Promise(resolve => { finishModule = resolve; }) : Promise.resolve();
  const gain = { value: 0, targets: [], cancelAndHoldAtTime() {}, setTargetAtTime(value) { this.targets.push(value); } };
  class Node {
    connect() {} disconnect() { calls.disconnected++; }
  }
  class Context {
    constructor() {
      calls.contexts++; this.state = 'suspended'; this.currentTime = 0; this.destination = new Node();
      this.audioWorklet = { addModule: async () => { calls.modules++; await moduleReady; if (failModule) throw new Error('module failed'); } };
    }
    resume() { calls.resumed++; this.state = 'running'; return Promise.resolve(); }
    close() { calls.closed++; this.state = 'closed'; return Promise.resolve(); }
    createGain() { const node = new Node(); node.gain = gain; return node; }
  }
  class Worklet extends Node {
    constructor() { super(); this.port = { postMessage: data => calls.messages.push(data), close() {} }; }
  }
  return { runtime: { AudioContext: Context, AudioWorkletNode: Worklet }, calls, gain, finishModule };
}

test('audio boundary creates only on start, stays muted until explicitly armed, and cleans up', async () => {
  const { runtime, calls, gain } = fakeRuntime(), audio = new WitchAudio(runtime);
  audio.update({ gate: true, speed: .9 }); assert.equal(audio.trigger('cackle'), false);
  assert.equal(calls.contexts, 0);
  await audio.start(); assert.equal(calls.contexts, 1); assert.equal(calls.resumed, 1);
  assert.equal(audio.audible, false); assert.equal(gain.targets.at(-1), 0);
  audio.setAudible(true); assert.equal(audio.running, true); assert.equal(gain.targets.at(-1), .6);
  assert.equal(audio.trigger('moan'), true);
  assert.equal(calls.messages.at(-1).kind, 'moan');
  audio.setAudible(false); assert.equal(gain.targets.at(-1), 0);
  assert.equal(audio.controls.gate, true, 'Audio does not change transport');
  const manager = getSharedAudioOutputManager(runtime);
  assert.equal(manager.connectionCount(), 1);
  await audio.dispose(); assert.equal(calls.closed, 1); assert.equal(manager.connectionCount(), 0);
  assert.equal(audio.context, null); assert.equal(audio.node, null);
  await assert.rejects(audio.start(), /disposed/);
});

test('concurrent start has one graph, and disposal during module loading cannot revive audio', async () => {
  const first = fakeRuntime({ deferModule: true }), audio = new WitchAudio(first.runtime);
  const a = audio.start(), b = audio.start(); assert.equal(a, b);
  assert.equal(first.calls.contexts, 1); assert.equal(first.calls.modules, 1); assert.equal(first.calls.resumed, 1);
  await audio.dispose(); first.finishModule(); assert.equal(await a, false);
  assert.equal(audio.node, null); assert.equal(audio.audible, false);
});

test('module load failure closes the context and leaves output disarmed', async () => {
  const { runtime, calls } = fakeRuntime({ failModule: true }), audio = new WitchAudio(runtime);
  await assert.rejects(audio.start(), /module failed/);
  assert.equal(calls.closed, 1); assert.equal(audio.context, null); assert.equal(audio.audible, false);
});
