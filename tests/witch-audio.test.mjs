import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP, FlightMixDelay } from '../src/instruments/witch/witch-worklet.js';
import { WitchAudio } from '../src/instruments/witch/witch-audio.js';
import { createWitchCatClock } from '../src/instruments/witch/witch-cat-model.js';
import { evaluateWitchHandPose, normalizeWitchControls, witchVoiceAtHeight, WITCH_DROP_EFFECTS, WITCH_VOCAL_EFFECTS, WITCH_FLIGHT_EFFECTS, WITCH_FINGER_SOURCES, WITCH_LAUNCH_DURATION, WITCH_VOICES } from '../src/instruments/witch/witch-model.js';
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
    for (const value of voices[i]) assert.ok(Number.isFinite(value) && Math.abs(value) <= .840001);
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

test('after a hush, voice and hand wake separately without leaking the other source or restarting the first', () => {
  for (const source of ['brew', 'hand']) {
    const sleeping = source === 'brew' ? 'hand' : 'brew';
    const dsp = playing(), reference = playing();
    assert.deepEqual(render(dsp, .5), render(reference, .5));
    assert.ok(dsp.visual.brewLevel > .001 && dsp.visual.handLevel > .001);
    for (const engine of [dsp, reference]) {
      engine.setControls({ gate: false, brewEnabled: false, handEnabled: false });
      render(engine, .04);
      assert.equal(engine.visual.brewLevel, 0); assert.equal(engine.visual.handLevel, 0);
      engine.setControls({ gate: true, [`${source}Enabled`]: true });
    }
    // The dormant engine still has a release in its resonators. Changing its
    // sound must leave the actually rendered output completely untouched.
    reference.setControls(source === 'brew' ? { handSound: 'buried-wires', fingers: [1, 0, 1, 0, 1] } : { voice: 'cackle' });
    const restingHandTime = dsp.visual.handTime;
    assert.deepEqual(render(dsp, .2), render(reference, .2));
    assert.ok(dsp.visual[`${source}Level`] > .001, `${source} wakes`);
    assert.equal(dsp.visual[`${sleeping}Level`], 0, `${sleeping} remains inaudible`);
    if (source === 'brew') assert.equal(dsp.visual.handTime, restingHandTime, 'sleeping hand keeps its pose');
    else assert.ok(dsp.visual.handTime > restingHandTime, 'the woken hand resumes its clock');

    const phrase = dsp.chantPhase, handTime = dsp.visual.handTime;
    dsp.setControls({ [`${sleeping}Enabled`]: true });
    assert.equal(dsp.chantPhase, phrase); assert.equal(dsp.visual.handTime, handTime);
    render(dsp, .2); render(reference, .2);
    assert.ok(dsp.visual.brewLevel > .001 && dsp.visual.handLevel > .001, 'the second source joins the first');
    const activeBuffer = source === 'brew' ? 0 : 2;
    assert.ok(difference(dsp.buffers[activeBuffer], reference.buffers[activeBuffer]) < 1e-8, 'joining the second source preserves the first waveform');
    dsp.setControls({ gate: false }); render(dsp, 6);
    // Normal Stop keeps the existing breath tail and its six-second ceiling.
    assert.ok(rms(render(dsp, .2)) < .00001, 'Stop releases both sources');
  }
});

test('independent source fades remain bounded and identical across render block sizes', () => {
  const a = playing(), b = playing();
  assert.deepEqual(render(a, .4), render(b, .4, RATE));
  for (const controls of [
    { brewEnabled: false }, { handEnabled: false }, { brewEnabled: true }, { handEnabled: true },
  ]) {
    a.setControls(controls); b.setControls(controls);
    const sound = render(a, .06);
    assert.deepEqual(sound, render(b, .06, RATE));
    assert.ok(sound.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  }
});

test('stalled UI and different render block sizes preserve exact audio-clock synthesis', () => {
  const a = playing({ mode: 'flight', speed: .85 }), b = playing({ mode: 'flight', speed: .85 });
  const uninterrupted = render(a, 5, 128);
  const singleCall = render(b, 5, RATE * 5);
  assert.deepEqual(uninterrupted, singleCall);
  assert.equal(a.visual.handTime, b.visual.handTime); assert.ok(a.visual.delayLevel > .001);
  assert.equal(a.visual.chantPhase, b.visual.chantPhase);
  assert.equal(a.visual.flightPhase, b.visual.flightPhase);
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

test('manual stirring rests, follows gestures and coasts independently of singing, hands and flight', () => {
  for (const mode of ['brew', 'flight']) {
    const dsp = playing({ mode, stirAuto: false, ghostGate: true });
    assert.ok(rms(render(dsp, .5)) > .005);
    assert.equal(dsp.visual.phase, 0); assert.equal(dsp.visual.speed, 0);
    assert.ok(dsp.visual.brewLevel > .001 && dsp.visual.handLevel > .001);
    dsp.setControls({ stirring: true }); render(dsp, .4);
    const speed = dsp.visual.speed, chant = dsp.visual.chantPhase;
    assert.ok(speed > .5); assert.ok(dsp.visual.phase > 0);
    dsp.setControls({ direction: -1 }); render(dsp, .1);
    assert.ok(dsp.visual.chantPhase < chant);
    dsp.setControls({ stirring: false }); render(dsp, .15);
    assert.ok(dsp.visual.speed < speed && dsp.visual.speed > speed * .8);
    const handTime = dsp.visual.handTime, flight = dsp.visual.flightPhase, ghost = dsp.visual.ghostPhase;
    dsp.setControls({ nose: .9, manualFingerMask: 2 }); render(dsp, 6);
    assert.ok(dsp.visual.speed < .006);
    assert.ok(dsp.visual.handTime > handTime && dsp.visual.ghostPhase > ghost);
    assert.ok(dsp.visual.brewLevel > .001 && dsp.visual.handLevel > .001);
    if (mode === 'flight') assert.ok(dsp.visual.flightPhase > flight && dsp.visual.delayLevel > .001);
    dsp.setControls({ stirAuto: true }); render(dsp, .4);
    assert.ok(dsp.visual.speed > .5);
  }
});

test('manual hand sounds respond to bends without restarting choreography or losing the pose on release', () => {
  const dsp = playing({ handAuto: false }); render(dsp, .2);
  const before = dsp.hand.targets.map(target => target.frequency);
  dsp.setControls({ fingers: [0, .9, .5, .5, .5], manualFingerMask: 3 });
  assert.ok(rms(render(dsp, .2)) > .005);
  const bent = structuredClone(dsp.hand.pose.fingers), frequencies = dsp.hand.targets.map(target => target.frequency);
  assert.notDeepEqual(frequencies.slice(0, 2), before.slice(0, 2));
  dsp.setControls({ manualFingerMask: 0 }); render(dsp, .3);
  assert.deepEqual(dsp.hand.pose.fingers, bent);
  assert.deepEqual(dsp.hand.targets.map(target => target.frequency), frequencies);
  assert.ok(dsp.visual.handLevel > .001 && dsp.visual.handTime > .6);
  dsp.setControls({ handAuto: true }); render(dsp, .3);
  assert.notDeepEqual(dsp.hand.pose.fingers, bent);
});

test('wail stretches and chatter breaks the vocal phrase while the fingers keep their independent clock', () => {
  const wail = playing({ voice: 'wail' }), ordinary = playing({ voice: 'mutter' }), chatter = playing({ voice: 'chatter' });
  render(wail, 2); render(ordinary, 2); render(chatter, 2);
  assert.ok(wail.chantPhase < ordinary.chantPhase * .35, 'wail holds much longer syllables');
  assert.ok(chatter.chantPhase > ordinary.chantPhase * 1.8, 'chatter runs faster through its uneven syllables');
  assert.equal(wail.visual.handTime, chatter.visual.handTime);
  assert.deepEqual(wail.buffers[2], chatter.buffers[2], 'voicing does not change finger audio');
  for (const dsp of [wail, chatter]) {
    const phrase = dsp.chantPhase, time = dsp.visual.handTime;
    dsp.setControls({ direction: -1 }); render(dsp, .25);
    assert.ok(dsp.chantPhase < phrase); assert.ok(dsp.visual.handTime > time);
    const reversed = dsp.chantPhase;
    dsp.setControls({ voice: 'sing' }); assert.equal(dsp.chantPhase, reversed, 'changing phrase never resets its clock');
    render(dsp, .1); assert.ok(dsp.chantPhase < reversed);
  }
});

test('both new vocal patterns preserve block-independent flight and release with bounded live changes', () => {
  for (const voice of ['wail', 'chatter']) {
    const a = playing({ voice, mode: 'flight', spellBalance: .88 });
    const b = playing({ voice, mode: 'flight', spellBalance: .88 });
    assert.deepEqual(render(a, 1.2), render(b, 1.2, RATE * 2));
    assert.ok(a.visual.brewLevel > .0005 && a.visual.handLevel > .001);
    a.setControls({ gate: false }); render(a, 9);
    assert.ok(rms(render(a, .1)) < 1e-6);
    for (const rate of [8000, 48000]) {
      const dsp = new WitchDSP(rate);
      dsp.setControls({ voice, gate: true, speed: 1, hair: 1, mode: 'flight', nose: 1, hat: 1, glass: 1 });
      assert.equal(rms(render(dsp, .1)), 0, 'a selected voice cannot arm Audio');
      dsp.setEnabled(true);
      for (let i = 0; i < 12; i++) {
        dsp.setControls({ spellBalance: i % 2, direction: i % 2 ? -1 : 1 });
        assert.ok(render(dsp, .04).every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
      }
      dsp.setEnabled(false); render(dsp, 2);
      assert.ok(rms(render(dsp, .1)) < 1e-7);
    }
  }
});

test('phase alignment joins silent motion without restarting a vocal phrase or arming audio', () => {
  const dsp = playing(); render(dsp, .5);
  const phrase = dsp.chantPhase; dsp.syncPhase(2.4, .62, 3.2);
  assert.equal(dsp.chantPhase, phrase); assert.ok(Math.abs(dsp.visual.phase - 2.4) < 1e-12);
  assert.equal(dsp.visual.speed, .62);
  assert.equal(dsp.visual.handTime, 3.2);
  const { runtime, calls } = fakeRuntime(), audio = new WitchAudio(runtime);
  audio.syncPhase(2.4, .62, 3.2);
  assert.equal(calls.contexts, 0); assert.equal(audio.audible, false);
  assert.equal(audio.visual.speed, .62);
  assert.equal(audio.visual.handTime, 3.2);
  dsp.setControls({ spoonAuto: true }); dsp.syncPhase(2.4, .62, 3.2, .83);
  audio.update({ spoonAuto: true }); audio.syncPhase(2.4, .62, 3.2, .83);
  assert.equal(dsp.visual.spoonHeight, .83); assert.equal(audio.visual.spoonHeight, .83);
  dsp.syncPhase(2.4, .62, 3.2); audio.syncPhase(2.4, .62, 3.2);
  assert.ok(dsp.visual.spoonHeight > .9, 'first arm joins the current automatic spoon position');
  assert.equal(audio.visual.spoonHeight, dsp.visual.spoonHeight);
  assert.equal(calls.contexts, 0); assert.equal(audio.audible, false);
});

test('flight and delay keep continuous phase through preset speed changes, stirring, first arm and Stop', () => {
  const dsp = playing({ mode: 'flight', speed: .4 });
  const { runtime } = fakeRuntime(), audio = new WitchAudio(runtime);
  dsp.syncPhase(0, .4, 20, undefined, 42);
  audio.syncPhase(0, .4, 20, undefined, 42);
  assert.equal(dsp.visual.flightPhase, 42); assert.equal(audio.visual.flightPhase, 42);
  assert.equal(audio.pendingPhase.flightPhase, 42);
  dsp.setControls({ flightSpeed: .9 });
  render(dsp, 1 / RATE);
  assert.ok(Math.abs(dsp.visual.flightPhase - 42 - 5.5 / RATE / 1.4) < 1e-10, 'speed changes the slope without relocating the broom');
  assert.equal(dsp.visual.flightPhase, dsp.delay.ridePhase / 1.4, 'the ride follows the same oscillator as the delay');
  const beforeStir = dsp.visual.flightPhase;
  dsp.setControls({ speed: 0, stirAuto: false }); render(dsp, .1);
  assert.ok(Math.abs(dsp.visual.flightPhase - beforeStir - 5.5 * .1 / 1.4) < 1e-9, 'resting the ladle leaves the flight pace intact');
  dsp.setControls({ gate: false }); const stopped = dsp.visual.flightPhase;
  render(dsp, .2); assert.equal(dsp.visual.flightPhase, stopped);
  dsp.setControls({ gate: true }); render(dsp, .2);
  assert.ok(Math.abs(dsp.visual.flightPhase - stopped - 5.5 * .2 / 1.4) < 1e-9);
  const fast = dsp.visual.flightPhase;
  dsp.setControls({ flightSpeed: .02 }); render(dsp, .2);
  assert.ok(Math.abs(dsp.visual.flightPhase - fast - 1.1 * .2 / 1.4) < 1e-9, 'the slow preset continues from the same place at one fifth the pace');
  audio.update({ flightSpeed: .02 }); audio.syncPhase(0, 0, 20);
  dsp.syncPhase(0, 0, 20);
  assert.equal(audio.visual.flightPhase, dsp.visual.flightPhase);
});

test('fingers shape materials; nose, hat and ingredients independently alter the ongoing singer', () => {
  const reference = render(playing({ mode: 'fingers', voice: 'sing' }));
  for (let index = 0; index < 5; index++) {
    const fingers = [.5, .5, .5, .5, .5]; fingers[index] = 1;
    assert.ok(difference(reference, render(playing({ mode: 'fingers', voice: 'sing', fingers }))) > .005, `finger ${index}`);
  }
  const singer = render(playing({ voice: 'sing' }));
  for (const controls of [{ radius: 0 }, { glass: 1 }, { hair: 1 }, { nose: 1 }, { hat: 1 }]) {
    assert.ok(difference(singer, render(playing({ voice: 'sing', ...controls }))) > .005, JSON.stringify(controls));
  }
});

test('cauldron vocal effects sound from a closed gate, finish, and have bounded polyphony', () => {
  const buffers = [];
  for (const kind of WITCH_VOCAL_EFFECTS) {
    const dsp = new WitchDSP(RATE); dsp.setEnabled(true);
    assert.equal(dsp.trigger(kind), true);
    const sound = render(dsp, 1); buffers.push(sound);
    assert.ok(rms(sound.subarray(0, RATE * .35)) > .005, kind);
    render(dsp, 4); assert.ok(rms(render(dsp, .2)) < .000001, `${kind} ends`);
  }
  for (let i = 1; i < buffers.length; i++) assert.ok(difference(buffers[0], buffers[i]) > .02);
  const dsp = playing({ speed: 1, glass: 1, hair: 1, fingers: [1, 1, 1, 1, 1] });
  for (let i = 0; i < 1000; i++) dsp.trigger(WITCH_VOCAL_EFFECTS[i % 5]);
  assert.equal(dsp.effects.length, 4);
  for (const value of render(dsp, 2)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .840001);
});

test('fingers retain five isolated Gesticules materials over a quiet cauldron and release together', () => {
  const signals = [];
  for (let finger = 0; finger < 5; finger++) {
    const dsp = playing({ mode: 'fingers', fingerMask: 1 << finger });
    assert.ok(dsp.hand instanceof HandDSP);
    signals.push(render(dsp, .35));
    assert.deepEqual(dsp.hand.voices.map(v => v.source), WITCH_FINGER_SOURCES);
    assert.ok(rms(signals[finger]) > .007);
    assert.ok(dsp.visual.mouth > 0); assert.ok(dsp.visual.brewLevel > .001);
    for (let i = 0; i < 5; i++) assert.equal(dsp.visual.fingerLevels[i] > .1, i === finger);
    dsp.setControls({ gate: false, fingerMask: 0 }); render(dsp, 6);
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
    const a = playing({ mode: 'fingers', fingerMask: 1 << finger, manualFingerMask: 1 << finger, fingers: low });
    const b = playing({ mode: 'fingers', fingerMask: 1 << finger, manualFingerMask: 1 << finger, fingers: high });
    const first = render(a, .35), second = render(b, .35);
    assert.ok(difference(first, second) > .008, `finger ${finger} pitch/tone destination`);
    assert.ok(b.hand.targets[finger].frequency > a.hand.targets[finger].frequency * 2);
    const held = playing({ mode: 'fingers', fingerMask: 1 << finger });
    const unrelated = [.5, .5, .5, .5, .5]; unrelated[(finger + 1) % 5] = 1;
    const other = playing({ mode: 'fingers', fingerMask: 1 << finger, fingers: unrelated });
    assert.deepEqual(render(held, .2), render(other, .2), 'unheld finger does not alter the held source');
    if (finger > 2) {
      render(a, 2.1); const quiet = a.visual.handLevel;
      a.setControls({ fingers: high });
      render(a, .1);
      assert.ok(a.visual.handLevel > quiet * 2 + .001, 'moving a ringing material re-excites it');
    }
  }
});

test('all focuses retain the singer and independently articulated instrumental hand', () => {
  for (const mode of ['fingers', 'flight']) {
    const a = playing({ mode, voice: 'whisper', glass: 0, hair: 0 });
    const b = playing({ mode, voice: 'cackle', glass: 1, hair: 1 });
    const delta = difference(render(a, 1), render(b, 1));
    assert.ok(delta > .005, 'the brewed voice remains audible');
    assert.ok(a.visual.mouth > 0 && a.visual.brewLevel > .001 && a.visual.handLevel > .001);
    assert.deepEqual(a.hand.targets, b.hand.targets, 'hand material controls stay independent');
    assert.equal(difference(a.buffers[2], b.buffers[2]), 0, 'the material performance stays identical');
    for (const kind of ['cackle', 'moan', 'howl']) assert.equal(a.trigger(kind), true, `${mode} accepts vocal gestures`);
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
  assert.ok(difference(render(slow, .5), render(fast, .5)) > .002, 'stir speed still shapes the background');
  assert.equal(difference(slow.buffers[2], fast.buffers[2]), 0, 'hand choreography is independent of the stir speed');
  assert.equal(slow.visual.handTime, fast.visual.handTime);
});

test('hand incantation and its quiet bed continue from the cauldron phase and release on Stop', () => {
  const moving = playing(), cauldron = playing();
  render(moving, .4); render(cauldron, .4);
  moving.setControls({ mode: 'fingers' });
  render(moving, .4); render(cauldron, .4);
  assert.equal(moving.chantPhase, cauldron.chantPhase, 'the existing phrase continues without restarting');
  assert.equal(moving.visual.phase, cauldron.visual.phase, 'stirring retains its exact phase');
  assert.ok(moving.visual.brewLevel > .001 && moving.visual.brewLevel < cauldron.visual.brewLevel * .38);
  assert.ok(moving.visual.handLevel > moving.visual.brewLevel * 1.3, 'the materials are foreground');
  const poseTime = Math.floor((Math.round(moving.time * RATE) - 1) / 32) * 32 / RATE;
  const expected = evaluateWitchHandPose(moving.controls, poseTime);
  for (let i = 0; i < 5; i++) for (const key of ['mcp', 'pip', 'dip', 'spread']) {
    assert.ok(Math.abs(moving.hand.pose.fingers[i][key] - expected.fingers[i][key]) < 1e-8, 'the rendered choreography drives the sound');
  }
  moving.setControls({ gate: false }); const heldTime = moving.visual.handTime;
  assert.ok(rms(render(moving, .08)) > .001, 'Stop releases rather than cutting the mix');
  render(moving, 6);
  assert.equal(moving.visual.handTime, heldTime);
  assert.ok(rms(render(moving, .2)) < .000001);
});

test('a held finger overrides the audio-clock gesture without dropping other voices or changing the brew', () => {
  const direct = playing({ mode: 'fingers' }), automatic = playing({ mode: 'fingers' });
  render(direct, .3); render(automatic, .3);
  direct.setControls({ fingers: [.5, .8, .5, .5, .5], manualFingerMask: 2 });
  render(direct, .3); render(automatic, .3);
  assert.deepEqual(direct.hand.pose.fingers[1], { mcp: 56, pip: 68, dip: 48, spread: 0 });
  assert.ok(direct.visual.fingerLevels.every(level => level > .1), 'all five material gates remain active during Play');
  assert.equal(difference(direct.buffers[0], automatic.buffers[0]), 0, 'instrumental finger edits leave the brewed anatomy alone');
  assert.ok(difference(direct.buffers[2], automatic.buffers[2]) > .001);
  const neighbour = direct.hand.pose.fingers[2].mcp; render(direct, .3);
  assert.notEqual(direct.hand.pose.fingers[2].mcp, neighbour);
  assert.equal(direct.hand.pose.fingers[1].mcp, 56);
  direct.setControls({ manualFingerMask: 0 }); render(direct, .2);
  assert.notEqual(direct.hand.pose.fingers[1].mcp, 56, 'release rejoins the incantation');
});

test('silent hand transport never arms sound and joins its phase when explicitly enabled', () => {
  const dsp = new WitchDSP(RATE); dsp.setControls({ mode: 'fingers', gate: true });
  assert.equal(rms(render(dsp, .4)), 0);
  assert.ok(Math.abs(dsp.visual.handTime - .4) < 1e-9);
  dsp.syncPhase(1.2, .6, 4.5); assert.equal(dsp.visual.handTime, 4.5);
  assert.equal(rms(render(dsp, .2)), 0);
  dsp.setEnabled(true); assert.ok(rms(render(dsp, .2)) > .005);
  assert.ok(Math.abs(dsp.visual.handTime - 4.9) < 1e-9);
});

test('flight controls change the shared stereo delay while both original performers continue', () => {
  const slow = playing({ mode: 'flight', speed: .05 }), fast = playing({ mode: 'flight', speed: .95 });
  // Longer flight delays take three seconds to reach their slewed targets.
  render(slow, 3); render(fast, 3);
  assert.equal(fast.delay.feedback, slow.delay.feedback, 'stirring speed no longer changes echo regeneration');
  assert.equal(slow.visual.delayTime, fast.visual.delayTime, 'noodle time is independent of stirring speed');
  fast.setControls({ trailFeedback: 1, trailPull: .08 }); render(fast, 3); render(slow, 3);
  assert.ok(fast.delay.feedback > slow.delay.feedback + .3);
  assert.ok(slow.visual.delayTime > fast.visual.delayTime + .5);
  assert.ok(fast.visual.brewLevel > .001 && fast.visual.handLevel > .001);
  assert.ok(fast.visual.flightPulse >= 0 && fast.visual.flightPulse <= 1);
  const low = playing({ mode: 'flight', altitude: .05 }), high = playing({ mode: 'flight', altitude: .95 });
  // Fill the older cloud before comparing the actual changed echoes.
  render(low, 4); render(high, 4);
  assert.ok(difference(render(low, 1), render(high, 1)) > .01);
  assert.ok(high.visual.delayTime > low.visual.delayTime + .08);
  const left = playing({ mode: 'flight', flightX: 0 }), right = playing({ mode: 'flight', flightX: 1 });
  render(left, 4); render(right, 4);
  assert.ok(difference(render(left, 1), render(right, 1)) > .005);
  assert.ok(right.delay.delayR > left.delay.delayR * 1.3);
});

test('flight scenery produces bounded musical effects and releases with no vocal mouth', () => {
  const signals = [];
  for (const kind of WITCH_FLIGHT_EFFECTS.filter(kind => kind !== 'launch')) {
    const dsp = playing({ mode: 'flight', gate: false });
    assert.equal(dsp.trigger(kind), true); signals.push(render(dsp, 1));
    assert.ok(rms(kind === 'bat' ? signals.at(-1).subarray(0, RATE * .5) : signals.at(-1)) > .005, kind);
    assert.equal(dsp.visual.mouth, 0);
    render(dsp, 8); assert.ok(rms(render(dsp, .1)) < .000001, `${kind} and its echoes end`);
  }
  for (let i = 1; i < signals.length; i++) assert.ok(difference(signals[0], signals[i]) > .015);
  const dsp = playing({ mode: 'flight' });
  for (let i = 0; i < 1000; i++) dsp.trigger(WITCH_FLIGHT_EFFECTS[i % 5]);
  assert.equal(dsp.flight.voices.length, 8);
  for (const value of render(dsp, 2)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .840001);
  dsp.setControls({ gate: false }); render(dsp, 9);
  assert.ok(rms(render(dsp, .2)) < .000001);
});

test('takeoff cackle is a bounded one-shot followed by a finite shared-delay tail', () => {
  const dsp = playing({ mode: 'flight', gate: false });
  assert.equal(dsp.trigger('launch'), true);
  const first = render(dsp, .2);
  assert.ok(rms(first) > .015);
  assert.ok(dsp.visual.launchEnvelope > .3 && dsp.visual.mouth > .3);
  assert.equal(dsp.visual.effect, 'launch');
  for (const value of render(dsp, WITCH_LAUNCH_DURATION)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .840001);
  assert.equal(dsp.flight.launch.active, false);
  assert.equal(dsp.visual.launchEnvelope, 0); assert.equal(dsp.visual.mouth, 0);
  assert.ok(rms(render(dsp, .3)) > .00001, 'the phrase enters the same flight delay');
  render(dsp, 8); assert.ok(rms(render(dsp, .3)) < 1e-7, 'echoes decay without another voice');
});

test('takeoff does not restart or automatically repeat over either ongoing performer', () => {
  const withLaunch = playing({ mode: 'flight' }), musicOnly = playing({ mode: 'flight' });
  withLaunch.trigger('launch');
  assert.ok(difference(render(withLaunch, .6), render(musicOnly, .6)) > .02);
  render(withLaunch, WITCH_LAUNCH_DURATION); render(musicOnly, WITCH_LAUNCH_DURATION);
  // A live Candy cloud keeps several seconds of history on each circulation.
  // Verify audible early repeats and their subsequent decay while music runs;
  // Stop's much shorter release is tested separately.
  const earlyEcho = difference(render(withLaunch, 4), render(musicOnly, 4));
  assert.ok(earlyEcho > .001, 'the launched phrase remains in the long history');
  render(withLaunch, 26); render(musicOnly, 26);
  const lateEcho = difference(render(withLaunch, 1), render(musicOnly, 1));
  assert.ok(lateEcho < earlyEcho * .001 && lateEcho < .00001, 'live repeats decay without retriggering the accent');
  assert.equal(withLaunch.visual.launchEnvelope, 0); assert.ok(withLaunch.visual.mouth > 0, 'singing continues');
  assert.equal(withLaunch.visual.handTime, musicOnly.visual.handTime);
  assert.equal(withLaunch.chantPhase, musicOnly.chantPhase);
});

test('repeated and near-expiry launches reuse one voice and have one finite end', () => {
  const dsp = playing({ mode: 'flight', gate: false });
  dsp.trigger('launch'); render(dsp, .3);
  const voice = dsp.flight.launch;
  for (let i = 0; i < 1000; i++) assert.equal(dsp.trigger('launch'), true);
  for (const value of render(dsp, .04)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .840001);
  assert.equal(dsp.flight.launch, voice); assert.equal(dsp.flight.voices.length, 8);
  assert.ok(voice.age < .04); assert.equal(voice.pending, false);
  render(dsp, WITCH_LAUNCH_DURATION - voice.age - .004);
  dsp.trigger('launch'); render(dsp, .025);
  assert.ok(voice.active && voice.age < .025, 'a takeoff near the previous expiry is preserved');
  render(dsp, WITCH_LAUNCH_DURATION + .1);
  assert.equal(voice.active, false); render(dsp, 8); assert.ok(rms(render(dsp, .2)) < 1e-7);
});

test('muting and Stop cancel takeoff without a stale phrase or echo on return', () => {
  const muted = playing({ mode: 'flight', gate: false }); muted.trigger('launch'); render(muted, .2);
  muted.setEnabled(false); assert.ok(rms(render(muted, .01)) > .0001, 'mute retains a short release');
  render(muted, .6); assert.equal(muted.flight.launch.active, false);
  assert.equal(muted.trigger('launch'), false);
  muted.setEnabled(true); assert.ok(rms(render(muted, .3)) < 1e-9);
  const stopped = playing({ mode: 'flight' }); stopped.trigger('launch'); render(stopped, .2);
  stopped.setControls({ gate: false }); render(stopped, .07);
  assert.equal(stopped.visual.launchActive, false); assert.equal(stopped.visual.launchEnvelope, 0);
  render(stopped, 9); assert.ok(rms(render(stopped, .3)) < .000001);
  assert.equal(stopped.trigger('launch'), true);
  assert.ok(rms(render(stopped, .3)) > .015, 'a new explicit accent sounds after Stop');
  assert.ok(stopped.delay.wet > .1, 'the new accent reopens the shared delay');
  const cauldron = playing(); assert.equal(cauldron.trigger('launch'), true);
});

test('takeoff timing and syllables are unchanged by rendering stalls', () => {
  const a = playing({ mode: 'flight' }), b = playing({ mode: 'flight' });
  a.trigger('launch'); b.trigger('launch');
  assert.deepEqual(render(a, 2.2, 128), render(b, 2.2, RATE * 3));
  assert.equal(a.visual.launchEnvelope, 0); assert.equal(b.visual.launchEnvelope, 0);
});

test('hand focus ducks the voice; flight changes neither performer clock nor their chosen balance', () => {
  for (const mode of ['fingers', 'flight']) {
    const a = playing({ voice: 'whisper' }), b = playing({ voice: 'sing' });
    render(a, .3); render(b, .3); a.trigger('cackle'); b.trigger('howl');
    a.setControls({ mode }); b.setControls({ mode });
    render(a, .06); render(b, .06);
    assert.ok(Math.abs(a.weights[0] - (mode === 'fingers' ? .18 : .72)) < 1e-12);
    assert.ok(Math.abs(b.weights[0] - (mode === 'fingers' ? .18 : .72)) < 1e-12);
    const delta = difference(render(a, .4), render(b, .4));
    assert.ok(delta > .005, 'both focuses retain the existing cauldron character and tail');
    assert.ok(a.visual.fingerLevels.every(level => level > .1));
  }
  const interrupted = playing(); render(interrupted, .2);
  interrupted.setControls({ mode: 'fingers' }); render(interrupted, .02);
  interrupted.setControls({ mode: 'flight' }); render(interrupted, .01);
  assert.ok(Math.abs(interrupted.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12,
    'interrupting a crossfade keeps its summed gain');
  interrupted.setControls({ mode: 'flight', handFocus: 1 }); render(interrupted, .1);
  assert.ok(Math.abs(interrupted.weights[0] - .18) < 1e-12, 'the hand may remain foreground during flight');
});

test('all ingredients add distinct softer bites while the continuing ensemble stays present', () => {
  const sounds = [];
  for (const kind of WITCH_DROP_EFFECTS) {
    const dsp = playing(), reference = playing(); render(dsp, .5); render(reference, .5);
    assert.ok(dsp.drops.hand instanceof HandDSP);
    assert.equal(dsp.trigger(kind), true);
    const sound = new Float32Array(RATE * .8);
    let soloEnergy = 0, backingEnergy = 0;
    for (let offset = 0; offset < sound.length; offset += 128) {
      dsp.process(sound.subarray(offset, Math.min(offset + 128, sound.length)));
      soloEnergy += dsp.visual.dropLevel ** 2;
      backingEnergy += dsp.visual.brewLevel ** 2 + dsp.visual.handLevel ** 2;
    }
    sounds.push(sound); render(reference, .8);
    assert.equal(dsp.visual.dropKind, kind); assert.ok(dsp.visual.dropEnvelope > .95);
    assert.ok(soloEnergy > backingEnergy * .06, `${kind} contributes a recognizable bite, including spaces between percussive hits`);
    assert.ok(dsp.visual.brewLevel > .001 && dsp.visual.handLevel > .001, 'the performers remain underneath');
    assert.ok(dsp.visual.brewLevel > reference.visual.brewLevel * .65 && dsp.visual.brewLevel < reference.visual.brewLevel * .8,
      'falling sounds sit inside the brew without nearly muting its singer');
    assert.equal(dsp.chantPhase, reference.chantPhase); assert.equal(dsp.visual.handTime, reference.visual.handTime);
    render(dsp, 6); render(reference, 6);
    assert.ok(dsp.visual.dropEnvelope < 1e-6); assert.equal(dsp.visual.dropKind, '');
    assert.ok(difference(render(dsp, .2), render(reference, .2)) < 1e-6, 'the original mix returns without restarting it');
  }
  for (let i = 1; i < sounds.length; i++) for (let j = 0; j < i; j++) {
    const a = WITCH_DROP_EFFECTS[j], b = WITCH_DROP_EFFECTS[i];
    if ([a, b].includes('drop-quadruped') && [a, b].includes('drop-cat')) {
      assert.deepEqual(sounds[j], sounds[i], 'the cupboard Quadruped intentionally shares the walking cat call');
    } else assert.ok(difference(sounds[j], sounds[i]) > .01, `${a} / ${b}`);
  }
});

test('all four layers coexist in flight; fixed solo slots and the complete mix release on Stop', () => {
  const dsp = playing({ mode: 'flight', handFocus: 1, speed: 1, altitude: 1 });
  render(dsp, .5);
  for (let i = 0; i < 300; i++) assert.equal(dsp.trigger(WITCH_DROP_EFFECTS[i % WITCH_DROP_EFFECTS.length]), true);
  for (const sample of render(dsp, 1)) assert.ok(Number.isFinite(sample) && Math.abs(sample) <= .840001);
  assert.equal(dsp.drops.slots.length, WITCH_DROP_EFFECTS.length); assert.equal(dsp.drops.hand.voices.length, 5);
  assert.equal(dsp.drops.tastes.clips['drop-spider'].instrumentId, 'spider-synth'); assert.equal(dsp.drops.tastes.roach.slots.length, 8);
  for (const key of ['brewLevel', 'handLevel', 'dropLevel', 'delayLevel']) assert.ok(dsp.visual[key] > .001, key);
  assert.ok(dsp.visual.delayWet > .5); assert.ok(dsp.delay.feedback <= .8);
  dsp.setControls({ gate: false }); const handTime = dsp.visual.handTime;
  assert.ok(rms(render(dsp, .04)) > .001, 'all layers release smoothly');
  render(dsp, 9);
  assert.ok(rms(render(dsp, .3)) < .000001);
  assert.equal(dsp.visual.handTime, handTime); assert.ok(dsp.visual.dropEnvelope < 1e-6);
});

test('dropped solos also work while stopped and do not arm Audio or depend on graphics', () => {
  const off = new WitchDSP(RATE); off.setControls({ gate: true, mode: 'flight' });
  for (const kind of WITCH_DROP_EFFECTS) assert.equal(off.trigger(kind), false);
  assert.equal(rms(render(off, .2)), 0);
  const a = playing({ mode: 'flight', gate: false }), b = playing({ mode: 'flight', gate: false });
  a.trigger('drop-marimba'); b.trigger('drop-marimba');
  const signal = render(a, 3.4, 128);
  assert.ok(rms(signal) > .005); assert.equal(difference(signal, render(b, 3.4, RATE * 4)), 0);
  assert.equal(a.visual.handTime, 0); render(a, 8); assert.ok(rms(render(a, .2)) < 1e-7);
});

test('the shared flight delay has smooth live control changes, bounded feedback and no stale mute tail', () => {
  const rate = 8000, delay = new FlightMixDelay(rate);
  delay.controls = normalizeWitchControls({ mode: 'flight', gate: true, speed: 1, altitude: 1 });
  let previous = 0, largestStep = 0, heardEcho = false;
  for (let i = 0; i < rate * 3; i++) {
    if (i === rate) delay.controls = normalizeWitchControls({ mode: 'flight', gate: true, speed: 0, altitude: 0, flightX: 0 });
    if (i === rate * 2) delay.controls = normalizeWitchControls({ mode: 'flight', gate: true, speed: 1, altitude: 1, flightX: 1 });
    const source = Math.sin(i / rate * Math.PI * 2 * 107) * .15;
    delay.next(source, source * .7, true);
    largestStep = Math.max(largestStep, Math.abs(delay.left - previous)); previous = delay.left;
    heardEcho ||= Math.abs(delay.wetLeft) > .01;
    assert.ok(Number.isFinite(delay.left) && Math.abs(delay.left) <= .54 && delay.feedback <= .8);
  }
  assert.ok(heardEcho); assert.ok(largestStep < .08, 'pointer jumps slew instead of clicking the read head');
  for (let i = 0; i < rate; i++) delay.next(0, 0, false);
  assert.ok(Math.abs(delay.left) < 1e-9); assert.equal(delay.cleared, true);
  for (let i = 0; i < rate; i++) { delay.next(0, 0, true); assert.ok(Math.abs(delay.left) < 1e-8); }
});

test('automatic spoon height selects every singing character on the sample clock and pauses on Stop', () => {
  const dsp = playing({ spoonAuto: true }), seen = new Set();
  for (let i = 0; i < 110; i++) { render(dsp, .1); seen.add(dsp.visual.activeVoice); }
  assert.deepEqual([...seen].sort(), [...WITCH_VOICES].sort());
  dsp.setControls({ gate: false }); const stopped = dsp.visual.spoonHeight;
  render(dsp, .5); assert.equal(dsp.visual.spoonHeight, stopped);
  dsp.setControls({ gate: true, spoonAuto: false, spoonHeight: .1, voice: witchVoiceAtHeight(.1) });
  render(dsp, 2); assert.equal(dsp.visual.activeVoice, 'mutter'); assert.ok(dsp.visual.spoonHeight < .11);
  const before = dsp.visual.spoonHeight; dsp.setControls({ spoonAuto: true }); render(dsp, .02);
  assert.ok(Math.abs(dsp.visual.spoonHeight - before) < .05, 'automatic motion resumes from the held height smoothly');
  const a = playing({ spoonAuto: true }), b = playing({ spoonAuto: true });
  assert.equal(difference(render(a, 2.4), render(b, 2.4, RATE * 3)), 0);
  assert.equal(a.visual.spoonHeight, b.visual.spoonHeight);
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
  for (const value of render(dsp, .5)) assert.ok(Number.isFinite(value) && Math.abs(value) <= .840001);
});

function fakeRuntime({ deferModule = false, failModule = false } = {}) {
  const calls = { contexts: 0, resumed: 0, modules: 0, closed: 0, messages: [], disconnected: 0 };
  let finishModule;
  const moduleReady = deferModule ? new Promise(resolve => { finishModule = resolve; }) : Promise.resolve();
  const makeGain = () => ({ value: 0, targets: [], events: [],
    cancelAndHoldAtTime(time) { this.events.push(['hold', time]); },
    cancelScheduledValues(time) { this.events.push(['cancel', time]); },
    setValueAtTime(value, time) { this.events.push(['value', value, time]); },
    linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); },
    setTargetAtTime(value) { this.targets.push(value); },
  });
  const gain = makeGain(), gains = [];
  class Node {
    constructor() { this.connections = []; }
    connect(node) { this.connections.push(node); } disconnect() { calls.disconnected++; }
  }
  class Context {
    constructor() {
      calls.contexts++; this.state = 'suspended'; this.currentTime = 0; this.destination = new Node();
      this.audioWorklet = { addModule: async () => { calls.modules++; await moduleReady; if (failModule) throw new Error('module failed'); } };
    }
    resume() { calls.resumed++; this.state = 'running'; return Promise.resolve(); }
    close() { calls.closed++; this.state = 'closed'; return Promise.resolve(); }
    createGain() { const node = new Node(); node.gain = gains.length ? makeGain() : gain; gains.push(node.gain); return node; }
  }
  class Worklet extends Node {
    constructor(_context, _name, options) { super(); calls.options = options; this.port = { postMessage: data => calls.messages.push(data), close() {} }; }
  }
  return { runtime: { AudioContext: Context, AudioWorkletNode: Worklet }, calls, gain, finishModule };
}

test('audio boundary creates only on start, stays muted until explicitly armed, and cleans up', async () => {
  const { runtime, calls, gain } = fakeRuntime(), audio = new WitchAudio(runtime);
  audio.update({ gate: true, speed: .9 }); assert.equal(audio.trigger('cackle'), false);
  assert.equal(calls.contexts, 0);
  await audio.start(); assert.equal(calls.contexts, 1); assert.equal(calls.resumed, 1);
  assert.equal(audio.presenceNode.gain.value, 1, 'the independent presence fade defaults to unity');
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

test('an unarmed audio handoff snapshots visitor captures without replaying their dive', () => {
  const { runtime, calls } = fakeRuntime(), audio = new WitchAudio(runtime);
  const captured = { mouse: { startedAt: 18.2 }, lizard: { startedAt: NaN }, cat: { startedAt: 31 } };
  audio.syncPhase(0, 0, 19, undefined, 0, 0, createWitchCatClock(19), 0, captured);
  assert.deepEqual(audio.pendingPhase.visitorCaptures, { mouse: 18.2 });
  captured.mouse.startedAt = 70;
  assert.equal(audio.pendingPhase.visitorCaptures.mouse, 18.2, 'the phase message owns its snapshot');
  assert.equal(calls.contexts, 0); assert.deepEqual(calls.messages, []);
  audio.syncPhase(0, 0, 0, undefined, 0, 0, createWitchCatClock(0), 0);
  assert.deepEqual(audio.pendingPhase.visitorCaptures, {}, 'reset clears the captured visit');
});

test('performance presence fades independently, reverses continuously and never creates or enables audio', async () => {
  const { runtime, calls } = fakeRuntime(), audio = new WitchAudio(runtime);
  audio.setPresence(0, 0);
  assert.equal(calls.contexts, 0); assert.equal(audio.presence, 0);
  await audio.start(); audio.setAudible(true);
  const node = audio.presenceNode, param = node.gain;
  assert.equal(param.value, 0, 'first construction keeps the stored silent presence');
  assert.equal(audio.node.connections[0], node); assert.equal(node.connections[0], audio.master);
  const controls = audio.controls, messageCount = calls.messages.length;
  audio.setPresence(1, .8);
  assert.deepEqual(param.events, [['hold', 0], ['value', 0, 0], ['linear', 1, .8]]);
  assert.equal(audio.controls, controls); assert.equal(audio.audible, true); assert.equal(calls.messages.length, messageCount);
  audio.context.currentTime = .2; audio.setPresence(0, .8);
  assert.deepEqual(param.events.slice(-3), [['hold', .2], ['value', .25, .2], ['linear', 0, 1]]);
  const fadeEvents = structuredClone(param.events);
  audio.update({ volume: .3 }); audio.setAudible(false); audio.setAudible(true);
  assert.deepEqual(param.events, fadeEvents, 'output level and Audio changes leave the presence ramp alone');
  audio.context.currentTime = .4; audio.setPresence(1, .6);
  assert.deepEqual(param.events.slice(-3), [['hold', .4], ['value', .1875, .4], ['linear', 1, 1]]);
  delete param.cancelAndHoldAtTime;
  audio.context.currentTime = .7; audio.setPresence(0, .2);
  assert.equal(param.events.at(-3)[0], 'cancel');
  assert.ok(Math.abs(param.events.at(-2)[1] - .59375) < 1e-12, 'the fallback also holds the current ramp value');
  audio.setPresence(4, 0); assert.deepEqual(param.events.at(-1), ['value', 1, .7]);
  await audio.dispose(); assert.equal(audio.presenceNode, null); assert.equal(audio.presenceFade, null);
  const eventsAfterDispose = param.events.length;
  audio.setPresence(1); assert.equal(param.events.length, eventsAfterDispose); assert.equal(calls.contexts, 1);
});

test('explicit accent release posts a separate message without arming or changing transport', async () => {
  const { runtime, calls } = fakeRuntime(), audio = new WitchAudio(runtime);
  audio.releaseAccents(); assert.equal(calls.contexts, 0); assert.equal(calls.messages.length, 0);
  audio.update({ gate: false, ghostGate: false }); await audio.start();
  const controls = audio.controls, phaseGeneration = audio.phaseGeneration, resumed = calls.resumed;
  audio.releaseAccents(); assert.deepEqual(calls.messages.at(-1), { type: 'release-accents' });
  assert.equal(audio.controls, controls); assert.equal(audio.phaseGeneration, phaseGeneration);
  assert.equal(audio.audible, false); assert.equal(calls.resumed, resumed);
  await audio.dispose();
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


test('queued pre-seek telemetry cannot restore old cat, hand, or ghost clocks after arming or Reset', async () => {
  const { runtime, calls } = fakeRuntime(), audio = new WitchAudio(runtime);
  await audio.start();
  const prior = { ...audio.visual, catClock: createWitchCatClock(31), handTime: 31, ghostPhase: 37 };
  audio.node.port.onmessage({ data: { type: 'visual', ...prior } });
  assert.equal(audio.visual.catClock.time, 31, 'untagged direct telemetry is supported before the first seek');
  audio.syncPhase(0, 0, 0, .5, 0, 0, createWitchCatClock(0));
  const resetGeneration = calls.messages.at(-1).phaseGeneration;
  for (const packet of [{ ...prior }, { ...prior, phaseGeneration: resetGeneration - 1 }]) {
    audio.node.port.onmessage({ data: { type: 'visual', ...packet } });
    assert.equal(audio.visual.catClock.time, 0); assert.equal(audio.visual.handTime, 0); assert.equal(audio.visual.ghostPhase, 0);
  }
  const fresh = { ...audio.visual, catClock: createWitchCatClock(.05), handTime: .05, ghostPhase: .06 };
  audio.node.port.onmessage({ data: { type: 'visual', ...fresh, phaseGeneration: resetGeneration } });
  assert.equal(audio.visual.catClock.time, .05, 'the acknowledged clock resumes live telemetry');
  audio.syncPhase(0, 0, 32, .5, 0, 40, createWitchCatClock(32));
  audio.node.port.onmessage({ data: { type: 'visual', ...fresh, phaseGeneration: resetGeneration } });
  assert.equal(audio.visual.catClock.time, 32, 'a subsequent arm/seek rejects the previous acknowledgement');
  const oldReceiver = audio.node.port.onmessage;
  audio.node.onprocessorerror(); await audio.start();
  assert.equal(calls.options.processorOptions.phaseGeneration, audio.phaseGeneration, 'a replacement worklet starts in the current generation');
  oldReceiver({ data: { type: 'visual', ...prior, phaseGeneration: audio.phaseGeneration } });
  assert.equal(audio.visual.catClock.time, 32, 'detached nodes cannot overwrite clocks even with a matching tag');
  await audio.dispose();
});

test('the real worklet acknowledges seeks promptly and rejects earlier generations', async () => {
  const keys = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime'];
  const previous = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const packets = []; let Processor;
  try {
    globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: value => packets.push(structuredClone(value)) }; } };
    globalThis.registerProcessor = (name, implementation) => { if (name === 'witch-voice') Processor = implementation; };
    globalThis.sampleRate = 8000; globalThis.currentTime = 0;
    await import('../src/instruments/witch/witch-worklet.js?seek-generation-regression');
    const node = new Processor({ processorOptions: { phaseGeneration: 7 } });
    const outputs = [[new Float32Array(128), new Float32Array(128)]];
    node.process([], outputs); assert.equal(packets.at(-1).phaseGeneration, 7);
    const phase = { type: 'phase', phase: 0, speed: 0, handTime: 31, ghostPhase: 37, catClock: createWitchCatClock(31), visitorCaptures: { mouse: 18.2 } };
    node.port.onmessage({ data: { ...phase, phaseGeneration: 6 } });
    assert.equal(node.dsp.cat.time, 0);
    node.port.onmessage({ data: { ...phase, phaseGeneration: 8 } });
    globalThis.currentTime = .001; node.process([], outputs);
    assert.equal(packets.at(-1).phaseGeneration, 8);
    assert.equal(packets.at(-1).catClock.time, 31);
    assert.equal(packets.at(-1).handTime, 31);
    assert.equal(packets.at(-1).ghostPhase, 37);
    assert.equal(node.dsp.visitors.visitors.find(visitor => visitor.id === 'mouse').capturedVisit, 0);
    node.port.onmessage({ data: { ...phase, handTime: 0, ghostPhase: 0, catClock: createWitchCatClock(0) } });
    globalThis.currentTime = .002; node.process([], outputs);
    assert.equal(packets.at(-1).phaseGeneration, 8, 'untagged direct phase callers keep the current generation');
    assert.equal(packets.at(-1).catClock.time, 0);
    assert.ok(node.dsp.visitors.visitors.every(visitor => visitor.capturedVisit === -1), 'rewinding rejects future captures');
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
