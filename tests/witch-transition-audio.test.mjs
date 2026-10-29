import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { WITCH_LAUNCH_DURATION, WITCH_TRANSITION_PHRASES, WITCH_TRANSITION_MAX_DURATION, WITCH_VOICES, witchVoiceAtHeight } from '../src/instruments/witch/witch-model.js';

const rms = data => Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
const difference = (a, b) => Math.sqrt(a.reduce((sum, sample, i) => sum + (sample - b[i]) ** 2, 0) / a.length);
function playing(rate, controls = {}) {
  const dsp = new WitchDSP(rate);
  dsp.setControls({ mode: 'flight', gate: false, speed: .55, radius: .65, spoonAuto: false, ...controls });
  dsp.setEnabled(true); return dsp;
}
function render(dsp, seconds, blockSize = 128) {
  const left = new Float32Array(Math.round(seconds * dsp.rate)), right = new Float32Array(left.length);
  for (let offset = 0; offset < left.length; offset += blockSize) {
    const end = Math.min(offset + blockSize, left.length);
    dsp.process(left.subarray(offset, end), right.subarray(offset, end));
  }
  for (const channel of [left, right]) for (const value of channel) assert.ok(Number.isFinite(value) && Math.abs(value) <= .840001);
  return left;
}
function renderVoice(voice, seconds) {
  return Float64Array.from({ length: Math.ceil(seconds * voice.rate) }, () => voice.next());
}

for (const rate of [44100, 48000]) {
  test(`${rate}: transition banks vary rhythm and pitch without adjacent repeats or automatic replay`, () => {
    const voice = new WitchDSP(rate).flight.launch;
    for (const kind of ['launch', 'landing']) {
      const selections = [], sounds = [];
      for (let i = 0; i < 11; i++) {
        voice.trigger(kind);
        const { variant, duration, phrase } = voice;
        if (i === 0) {
          assert.equal(variant, 0);
          if (kind === 'launch') assert.equal(duration, WITCH_LAUNCH_DURATION);
        }
        assert.ok(duration <= WITCH_TRANSITION_MAX_DURATION);
        assert.notEqual(variant, selections.at(-1)?.variant);
        selections.push({ variant, duration, rhythm: phrase.syllables.map(row => row.slice(0, 2)), pitches: phrase.syllables.map(row => row[3]) });
        const sound = renderVoice(voice, duration + .005);
        for (const sample of sound) assert.ok(Number.isFinite(sample) && Math.abs(sample) < 1);
        assert.ok(rms(sound) > .01, `${kind} ${variant} has a finite audible phrase`);
        if (i < 5) sounds.push(sound.subarray(0, Math.round(rate * .35)));
        assert.equal(voice.active, false); assert.equal(voice.envelope, 0); assert.equal(voice.mouth, 0);
        assert.equal(rms(renderVoice(voice, .01)), 0, 'expired phrases never replay themselves');
      }
      assert.equal(new Set(selections.slice(0, 5).map(item => item.variant)).size, 5);
      assert.equal(new Set(selections.slice(5, 10).map(item => item.variant)).size, 5);
      assert.equal(new Set(selections.slice(0, 5).map(item => item.duration)).size, 5);
      assert.equal(new Set(selections.slice(0, 5).map(item => JSON.stringify(item.rhythm))).size, 5);
      assert.equal(new Set(selections.slice(0, 5).map(item => JSON.stringify(item.pitches))).size, 5);
      for (let i = 1; i < sounds.length; i++) {
        const delta = Float64Array.from(sounds[i], (value, j) => value - sounds[0][j]);
        assert.ok(rms(delta) > .01, 'variation changes the rendered gesture, not only metadata');
      }
    }
  });

  test(`${rate}: transition selection/reset are deterministic and independent of audio noise consumption`, () => {
    const dsp = new WitchDSP(rate), a = dsp.flight.launch, b = new WitchDSP(rate).flight.launch;
    const first = [], sequence = [];
    for (let i = 0; i < 15; i++) {
      const kind = i % 2 ? 'landing' : 'launch';
      a.trigger(kind); b.trigger(kind);
      assert.equal(a.variant, b.variant);
      sequence.push([kind, a.variant]);
      const sample = renderVoice(a, .03);
      if (i === 0) first.push(...sample);
      renderVoice(b, .071); // The timbre noise stream must not choose phrases.
      a.clear(); b.clear();
    }
    const arrays = [...a.orders, a.cursors, a.previous];
    dsp.flight.clear();
    for (const [i, [kind, expected]] of sequence.entries()) {
      a.trigger(kind); assert.equal(a.variant, expected);
      if (i === 0) assert.deepEqual(Array.from(renderVoice(a, .03)), first, 'reset restores the original voice waveform too');
      a.clear();
    }
    assert.deepEqual([...a.orders, a.cursors, a.previous].map((array, i) => array === arrays[i]), [true, true, true, true]);
  });

  test(`${rate}: landing remains audible with matching mouth telemetry in every scene`, () => {
    for (const mode of ['brew', 'fingers', 'flight']) {
      const dsp = playing(rate, { mode });
      assert.equal(dsp.trigger('landing'), true);
      assert.ok(rms(render(dsp, .12)) > .01, mode);
      assert.equal(dsp.visual.launchActive, true); assert.equal(dsp.visual.launchKind, 'landing');
      assert.equal(dsp.visual.launchVariant, 0);
      assert.equal(dsp.visual.launchDuration, WITCH_TRANSITION_PHRASES.landing[0].duration);
      assert.ok(Math.abs(dsp.visual.launchAge - .12) < 1 / rate);
      assert.ok(dsp.visual.mouth > .1 && dsp.visual.launchEnvelope > .1);
      assert.equal(dsp.visual.effect, 'landing');
      assert.equal(dsp.visual.brewLevel, 0); assert.equal(dsp.visual.handLevel, 0);
    }
  });

  test(`${rate}: rapid alternating transitions coalesce into one smooth latest cue`, () => {
    const a = new WitchDSP(rate).flight.launch, b = new WitchDSP(rate).flight.launch;
    for (const voice of [a, b]) { voice.trigger(); renderVoice(voice, .2); }
    const order = a.orders, formants = a.formants;
    for (let i = 0; i < 1000; i++) a.trigger(i % 2 ? 'landing' : 'launch');
    b.trigger('landing');
    assert.deepEqual(renderVoice(a, .03), renderVoice(b, .03), 'spammed requests equal one final request');
    assert.equal(a.kind, 'landing'); assert.equal(a.variant, 0); assert.equal(a.pending, false);
    assert.ok(a.age > .017 && a.age < .019, 'the existing 12 ms release precedes the new phrase');
    assert.equal(a.orders, order); assert.equal(a.formants, formants);
    // Retriggering at the very end must still deliver the latest requested kind.
    renderVoice(a, a.duration - a.age - .002);
    a.trigger('launch'); renderVoice(a, .02);
    assert.equal(a.kind, 'launch'); assert.equal(a.active, true); assert.notEqual(a.variant, 0);
    renderVoice(a, WITCH_TRANSITION_MAX_DURATION + .02);
    assert.equal(a.active, false); assert.equal(a.pending, false);
  });

  test(`${rate}: transition sound and performers follow samples across block sizes and scene changes`, () => {
    const a = playing(rate, { gate: true }), b = playing(rate, { gate: true }), reference = playing(rate, { gate: true });
    for (const [mode, kind] of [['flight', 'launch'], ['brew', 'landing'], ['flight', 'launch'], ['fingers', 'landing']]) {
      for (const dsp of [a, b, reference]) dsp.setControls({ mode });
      a.trigger(kind); b.trigger(kind);
      assert.deepEqual(render(a, .237, 137), render(b, .237, 8192));
      render(reference, .237);
      assert.equal(a.chantPhase, reference.chantPhase);
      assert.ok(Math.abs(a.visual.handTime - reference.visual.handTime) < 1e-12, 'performer clocks differ only by block-sum floating point roundoff');
      assert.deepEqual(a.weights, reference.weights);
      assert.equal(a.visual.singingGain, 0); assert.equal(a.visual.brewLevel, 0);
      assert.ok(a.visual.handLevel > 0, 'the hand keeps playing while the laugh owns the singing lane');
      assert.equal(a.visual.launchVariant, b.visual.launchVariant); assert.equal(a.visual.launchAge, b.visual.launchAge);
    }
  });

  test(`${rate}: Audio off, Stop and accent release cancel both kinds and pending cues`, () => {
    for (const kind of ['launch', 'landing']) for (const cancel of [dsp => dsp.setEnabled(false), dsp => dsp.setControls({ gate: false }), dsp => dsp.releaseAccents()]) {
      const dsp = playing(rate, { mode: 'brew', gate: true, brewEnabled: false, handEnabled: false });
      dsp.trigger(kind); render(dsp, .1);
      dsp.trigger(kind === 'launch' ? 'landing' : 'launch');
      cancel(dsp); render(dsp, .03);
      assert.equal(dsp.visual.launchActive, false); assert.equal(dsp.visual.launchEnvelope, 0); assert.equal(dsp.visual.mouth, 0);
      assert.equal(dsp.flight.launch.pending, false);
      dsp.setEnabled(true); render(dsp, .03);
      assert.equal(dsp.visual.launchActive, false, 'reenabling Audio cannot replay a canceled transition');
    }
    const unarmed = new WitchDSP(rate);
    assert.equal(unarmed.trigger('launch'), false); assert.equal(unarmed.trigger('landing'), false);
    assert.equal(rms(render(unarmed, .03)), 0);
  });

  test(`${rate}: each cue replaces the chant through syllable gaps and returns it without interrupting the hand`, () => {
    for (const kind of ['launch', 'landing']) {
      const dsp = playing(rate, { gate: true, voice: 'sing' }), reference = playing(rate, { gate: true, voice: 'sing' });
      assert.deepEqual(render(dsp, .2), render(reference, .2));
      dsp.trigger(kind);
      render(dsp, .04); render(reference, .04);
      assert.equal(dsp.visual.singingGain, 0); assert.equal(dsp.visual.brewLevel, 0);
      assert.ok(dsp.visual.handLevel > .001);
      const [[start, length], [nextStart]] = WITCH_TRANSITION_PHRASES[kind][0].syllables;
      const gapTime = (start + length + nextStart) * .5;
      const toGap = gapTime - dsp.flight.launch.age;
      render(dsp, toGap); render(reference, toGap);
      assert.equal(dsp.visual.launchActive, true); assert.equal(dsp.visual.launchEnvelope, 0);
      assert.equal(dsp.visual.singingGain, 0); assert.equal(dsp.visual.brewLevel, 0);
      assert.equal(dsp.visual.mouth, 0, 'the normal sung mouth cannot reappear between laugh syllables');
      assert.deepEqual(dsp.buffers[2], reference.buffers[2]); assert.deepEqual(dsp.buffers[3], reference.buffers[3]);
      assert.equal(dsp.chantPhase, reference.chantPhase); assert.equal(dsp.visual.handTime, reference.visual.handTime);
      const toRecovery = dsp.flight.launch.duration - dsp.flight.launch.age + .06;
      render(dsp, toRecovery); render(reference, toRecovery);
      assert.equal(dsp.visual.launchActive, false); assert.equal(dsp.visual.singingGain, 1);
      assert.ok(dsp.visual.brewLevel > .001 && dsp.visual.handLevel > .001);
      assert.equal(dsp.chantPhase, reference.chantPhase); assert.equal(dsp.visual.handTime, reference.visual.handTime);
      assert.deepEqual(dsp.buffers[0], reference.buffers[0], 'the singer kept its source history while inaudible');
    }
  });

  test(`${rate}: a cue over a hushed scene keeps its delay tail without waking automatic voices`, () => {
    const dsp = playing(rate, { brewEnabled: false, handEnabled: false, backingEnabled: false });
    render(dsp, .08);
    const controls = dsp.controls, handTime = dsp.visual.handTime;
    dsp.trigger('launch'); assert.ok(rms(render(dsp, .12)) > .005);
    assert.equal(dsp.visual.singingGain, 0); assert.equal(dsp.visual.brewLevel, 0); assert.equal(dsp.visual.handLevel, 0);
    render(dsp, dsp.flight.launch.duration - dsp.flight.launch.age + .06);
    assert.equal(dsp.visual.launchActive, false); assert.equal(dsp.visual.singingGain, 1);
    assert.equal(dsp.visual.brewLevel, 0); assert.equal(dsp.visual.handLevel, 0); assert.equal(dsp.visual.mouth, 0);
    assert.equal(dsp.visual.handTime, handTime); assert.equal(dsp.controls, controls);
    assert.equal(dsp.controls.gate, false); assert.equal(dsp.controls.brewEnabled, false); assert.equal(dsp.controls.handEnabled, false);
    assert.ok(rms(render(dsp, .2)) > .000001, 'the finished cue retains its existing echo history');
  });

  test(`${rate}: a phrase captures the actual spoon voice at the request and keeps it until the next cue`, () => {
    const dsp = playing(rate, { gate: true, spoonAuto: true, voice: 'whisper' });
    dsp.syncPhase(0, .55, 0, .94); render(dsp, .001);
    const actualVoice = witchVoiceAtHeight(dsp.brew.spoonHeight);
    assert.notEqual(actualVoice, dsp.controls.voice);
    assert.equal(dsp.brew.activeVoice, actualVoice);
    dsp.trigger('launch'); assert.equal(dsp.flight.launch.voice, actualVoice);
    render(dsp, .12); assert.equal(dsp.visual.launchVoice, actualVoice);
    dsp.setControls({ spoonAuto: false, voice: 'sing' }); render(dsp, .12);
    assert.equal(dsp.visual.activeVoice, 'sing'); assert.equal(dsp.visual.launchVoice, actualVoice);
    assert.equal(dsp.flight.launch.voice, actualVoice, 'mid-phrase voice selection does not replace the captured character');
    render(dsp, dsp.flight.launch.duration - dsp.flight.launch.age + .06);
    dsp.trigger('landing'); render(dsp, .1);
    assert.equal(dsp.flight.launch.voice, 'sing'); assert.equal(dsp.visual.launchVoice, 'sing');

    dsp.setControls({ voice: 'creak' }); dsp.trigger('launch');
    dsp.setControls({ voice: 'whisper' }); dsp.trigger('launch');
    dsp.setControls({ voice: 'mutter' }); render(dsp, .03);
    assert.equal(dsp.visual.launchKind, 'launch');
    assert.equal(dsp.visual.launchVoice, 'whisper', 'the latest request owns the queued voice; later unrelated changes cannot replace it');
  });

  test(`${rate}: the same laugh phrase renders the seven singing characters distinctly`, () => {
    const sounds = [];
    for (const voice of WITCH_VOICES) {
      const dsp = playing(rate, { voice, brewEnabled: false, handEnabled: false, backingEnabled: false });
      render(dsp, .18); dsp.trigger('launch');
      const sound = render(dsp, .46);
      assert.equal(dsp.visual.launchVariant, 0); assert.equal(dsp.visual.launchVoice, voice);
      assert.ok(rms(sound) > .001, `${voice} remains audible`);
      for (const previous of sounds) assert.ok(difference(sound, previous.sound) > .001, `${voice} differs from ${previous.voice}`);
      sounds.push({ voice, sound });
    }
  });

  test(`${rate}: nose, hat, glass and hair remain audible live controls inside the captured laugh`, () => {
    for (const [control, value] of [['nose', 1], ['hat', 0], ['glass', 1], ['hair', 1]]) {
      const controls = { voice: 'sing', brewEnabled: false, handEnabled: false, backingEnabled: false };
      const changed = playing(rate, controls), reference = playing(rate, controls);
      for (const dsp of [changed, reference]) { render(dsp, .18); dsp.trigger('launch'); }
      assert.deepEqual(render(changed, .16), render(reference, .16));
      changed.setControls({ [control]: value });
      assert.ok(difference(render(changed, .16), render(reference, .16)) > .0001, `${control} changes the sounding phrase`);
      assert.equal(changed.visual.launchVoice, 'sing'); assert.equal(changed.visual.launchVariant, reference.visual.launchVariant);
      assert.equal(changed.visual.launchAge, reference.visual.launchAge);
    }
  });
}
