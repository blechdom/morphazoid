import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { normalizeWitchControls, witchGhostFrame } from '../src/instruments/witch/witch-model.js';
import { SyrinxSourceEngine } from '../src/families/syrinx/syrinx-source-models.js';

const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
const difference = (a, b) => rms(a.map((value, index) => value - b[index]));
function render(dsp, seconds, blockSize = 128) {
  const data = new Float32Array(Math.round(seconds * dsp.rate));
  let ghosts = 0, bed = 0;
  for (let offset = 0; offset < data.length; offset += blockSize) {
    const chunk = data.subarray(offset, Math.min(data.length, offset + blockSize));
    dsp.process(chunk);
    ghosts += dsp.visual.ghostLevel ** 2 * chunk.length;
    bed += (dsp.visual.brewLevel ** 2 + dsp.visual.handLevel ** 2) * chunk.length;
  }
  return { data, ghostRms: Math.sqrt(ghosts / data.length), bedRms: Math.sqrt(bed / data.length) };
}
function playing(controls = {}, rate = 24000) {
  const dsp = new WitchDSP(rate);
  dsp.setControls({ gate: true, ghostGate: true, ghostTempo: 180, speed: .5, ...controls });
  dsp.setEnabled(true);
  return dsp;
}

test('ghost controls are bounded and the same beat frame fades all three visitors completely in and out', () => {
  assert.equal(normalizeWitchControls().ghostTempo, 72);
  assert.equal(normalizeWitchControls().ghostGate, false);
  assert.equal(normalizeWitchControls({ ghostGate: 1 }).ghostGate, false);
  assert.equal(normalizeWitchControls({ ghostTempo: NaN }).ghostTempo, 72);
  assert.equal(normalizeWitchControls({ ghostTempo: 0 }).ghostTempo, 36);
  assert.equal(normalizeWitchControls({ ghostTempo: Infinity }).ghostTempo, 72);
  assert.equal(normalizeWitchControls({ ghostTempo: 1000 }).ghostTempo, 180);
  for (let index = 0; index < 3; index++) {
    let minimum = 1, maximum = 0, beats = 0;
    for (let phase = 0; phase < 24; phase += .025) {
      const frame = witchGhostFrame(phase, index), repeated = witchGhostFrame(phase + 24, index);
      assert.ok(frame.presence >= 0 && frame.presence <= 1);
      assert.ok(frame.pulse >= 0 && frame.pulse <= frame.presence * 1.35);
      assert.ok(Math.abs(frame.presence - repeated.presence) < 1e-10);
      assert.ok(Math.abs(frame.pulse - repeated.pulse) < 1e-10);
      minimum = Math.min(minimum, frame.presence); maximum = Math.max(maximum, frame.presence);
      if (frame.pulse > .3) beats++;
    }
    assert.equal(minimum, 0); assert.equal(maximum, 1); assert.ok(beats > 0);
    assert.equal(witchGhostFrame(index * 8 + 1, index).presence, .5);
    assert.equal(witchGhostFrame(index * 8 + 13, index).presence, 0);
  }
});

test('the independent beat clock runs silently, freezes on transport Stop, and preserves phase through edits', () => {
  const dsp = new WitchDSP(24000);
  dsp.setControls({ ghostGate: true, ghostTempo: 72, gate: false });
  dsp.syncPhase(0, 0, 0, .5, 0, 7.23);
  assert.equal(rms(render(dsp, 1).data), 0);
  assert.ok(Math.abs(dsp.visual.ghostPhase - 8.43) < 1e-9);
  assert.equal(dsp.visual.handTime, 0, 'the background clock is independent of manual singer/finger gates');
  const before = dsp.visual.ghostPhase;
  dsp.setControls({ ghostTempo: 144, mode: 'flight', voice: 'creak', handFocus: 1 });
  assert.equal(dsp.visual.ghostPhase, before);
  render(dsp, .5);
  assert.ok(Math.abs(dsp.visual.ghostPhase - before - 1.2) < 1e-9);
  for (let index = 0; index < 3; index++) {
    const expected = witchGhostFrame(dsp.visual.ghostPhase, index);
    assert.equal(dsp.visual.ghostPresence[index], expected.presence);
    assert.equal(dsp.visual.ghostPulses[index], expected.pulse);
  }
  dsp.setControls({ ghostGate: false, gate: true }); const stopped = dsp.visual.ghostPhase;
  render(dsp, .5); assert.equal(dsp.visual.ghostPhase, stopped);
  dsp.setControls({ ghostGate: true }); render(dsp, .5);
  assert.ok(Math.abs(dsp.visual.ghostPhase - stopped - 1.2) < 1e-9);
});

test('the three fixed ghost voices reuse the source family and have distinct, finite rhythmic sketches', () => {
  const signals = [];
  for (let index = 0; index < 3; index++) {
    const dsp = playing(), ghost = dsp.ghosts, controls = dsp.controls;
    ghost.syncPhase(index * 8 + 4);
    const voices = ghost.voices.slice(), sound = new Float32Array(dsp.rate);
    for (let sample = 0; sample < sound.length; sample++) {
      ghost.next(controls, true); sound[sample] = (ghost.left + ghost.right) * .5;
    }
    assert.ok(rms(sound) > .015, `ghost ${index} has an audible source before its background trim`);
    assert.ok(sound.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
    assert.deepEqual(ghost.voices, voices, 'the visitor reuses its fixed state');
    assert.equal(ghost.voices.length, 3);
    assert.ok(ghost.voices[0].source instanceof SyrinxSourceEngine);
    assert.ok(ghost.voices[1].source instanceof SyrinxSourceEngine);
    signals.push(sound);
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < i; j++) assert.ok(difference(signals[i], signals[j]) > .025);
});

test('ghosts remain behind every singing character and hand focus at low and normal sample rates', () => {
  for (const rate of [8000, 48000]) for (const voice of ['mutter', 'whisper', 'creak', 'cackle', 'sing']) {
    const dsp = playing({ voice, handFocus: voice === 'whisper' ? 1 : 0 }, rate);
    const result = render(dsp, 8);
    assert.ok(result.ghostRms > .0001, `${voice}/${rate} has a background pulse`);
    assert.ok(result.ghostRms < result.bedRms * .2, `${voice}/${rate} keeps the ghosts behind the main ensemble`);
    assert.ok(result.data.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
    assert.ok(Math.abs(dsp.visual.ghostPhase - 24) < 1e-7);
  }
});

test('featured potion solos duck the ghosts with the backing without disturbing their clock', () => {
  const plain = playing(), solo = playing();
  for (const dsp of [plain, solo]) {
    dsp.syncPhase(0, .5, 0, .5, 0, 4);
    render(dsp, .35);
  }
  solo.trigger('drop-roach');
  render(plain, .2); render(solo, .2);
  const normal = render(plain, .8), featured = render(solo, .8);
  assert.ok(featured.ghostRms > 0);
  assert.ok(featured.ghostRms < normal.ghostRms * .205);
  assert.equal(solo.visual.ghostPhase, plain.visual.ghostPhase);
  assert.equal(solo.visual.ghostPresence[0], plain.visual.ghostPresence[0]);
  assert.equal(solo.visual.handTime, plain.visual.handTime);
});

test('background rhythm is block-independent and enters the same flight delay as the complete ensemble', () => {
  const a = playing({ mode: 'flight' }), b = playing({ mode: 'flight' }), dry = playing();
  for (const dsp of [a, b, dry]) dsp.syncPhase(0, .5, 0, .5, 0, 4);
  assert.deepEqual(render(a, 2).data, render(b, 2, 24000).data);
  render(dry, 2);
  assert.equal(a.visual.ghostPhase, b.visual.ghostPhase);
  assert.equal(a.visual.ghostLevel, dry.visual.ghostLevel, 'flight processes the existing background, without replacing it');
  assert.ok(a.visual.delayLevel > .001 && a.visual.delayWet > .1);
});

test('stop and mute release the beat; resuming midway through an old hit waits for the next onset', () => {
  const dsp = playing({ mode: 'flight' }); dsp.syncPhase(0, .5, 0, .5, 0, 4);
  render(dsp, .09); assert.ok(dsp.visual.ghostLevel > .0001);
  dsp.setControls({ ghostGate: false }); const phase = dsp.visual.ghostPhase;
  render(dsp, 1); assert.equal(dsp.visual.ghostPhase, phase); assert.ok(dsp.visual.ghostLevel < 1e-8);
  dsp.setControls({ ghostGate: true });
  render(dsp, .05); assert.equal(dsp.visual.ghostLevel, 0, 'the previous partial beat does not attack again');
  render(dsp, 1); assert.ok(dsp.visual.ghostPhase > phase);
  dsp.setEnabled(false); const mutedPhase = dsp.visual.ghostPhase;
  assert.ok(rms(render(dsp, .03).data) > 0, 'mute fades rather than discontinuously cutting audio');
  render(dsp, 1);
  assert.ok(dsp.visual.ghostPhase > mutedPhase, 'muting audio leaves transport moving');
  assert.ok(rms(render(dsp, .1).data) < 1e-7);
  dsp.setEnabled(true); dsp.setControls({ gate: false, ghostGate: false });
  render(dsp, 9); assert.ok(rms(render(dsp, .1).data) < 1e-7);
});
