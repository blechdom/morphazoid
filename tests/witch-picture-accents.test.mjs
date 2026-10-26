import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchPictureAccents } from '../src/instruments/witch/witch-scene-audio.js';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';

const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
const difference = (a, b) => rms(a.map((value, i) => value - b[i]));
function renderAccent(voice, seconds, enabled = true, rate = 8000) {
  const left = new Float32Array(Math.round(rate * seconds)), right = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) { voice.next(enabled); left[i] = voice.left; right[i] = voice.right; }
  return { left, right };
}
function crossings(data) {
  let count = 0;
  for (let i = 1; i < data.length; i++) if (data[i] * data[i - 1] < 0) count++;
  return count;
}
function renderMix(dsp, seconds, block = 128) {
  const data = new Float32Array(Math.round(dsp.rate * seconds));
  for (let i = 0; i < data.length; i += block) dsp.process(data.subarray(i, Math.min(i + block, data.length)));
  return data;
}

test('the die rings high inharmonic bells while mushrooms answer with lower finite liquid glides', () => {
  const sounds = [];
  for (const kind of ['dice-charm', 'mushroom-gloop']) {
    const voice = new WitchPictureAccents(8000);
    assert.equal(voice.trigger(kind), true);
    const sound = renderAccent(voice, 1.8); sounds.push(sound.left);
    assert.equal(sound.left[0], 0); assert.equal(sound.right[0], 0);
    assert.ok(rms(sound.left) > .008, `${kind}: an audible accent with its own tail`);
    assert.ok(difference(sound.left, sound.right) > .003, 'successive bells or globs occupy a modest stereo spread');
    for (const channel of [sound.left, sound.right]) assert.ok(channel.every(value => Number.isFinite(value) && Math.abs(value) < .22));
    assert.ok(sound.left.subarray(800).some(value => Math.abs(value) > .01), 'the gesture continues beyond the first attack');
    assert.equal(voice.left, 0); assert.equal(voice.right, 0);
    assert.ok(voice.slots.every(slot => slot.age < 0));
  }
  assert.ok(difference(...sounds) > .02, 'the two objects have different sounding gestures');
  assert.ok(crossings(sounds[0]) > crossings(sounds[1]) * 2, 'the bell cluster stays clearly above the low globs');
});

test('picture accents reuse two slots, fade retriggers and release without a muted backlog', () => {
  const voice = new WitchPictureAccents(8000), held = new WitchPictureAccents(8000), pool = voice.slots.slice();
  assert.equal(voice.trigger('unrelated-cue'), false);
  for (const synth of [voice, held]) { synth.trigger('dice-charm'); renderAccent(synth, .11); }
  voice.trigger('dice-charm'); voice.next(true); held.next(true);
  assert.ok(Math.abs(voice.left - held.left) < .005, 'retrigger starts with a fade rather than a waveform reset');
  for (let i = 0; i < 100; i++) {
    voice.trigger('dice-charm'); voice.trigger('mushroom-gloop');
    const sound = renderAccent(voice, .004);
    assert.ok(sound.left.every(value => Number.isFinite(value) && Math.abs(value) < .44));
  }
  assert.ok(voice.slots.every((slot, i) => slot === pool[i]));
  renderAccent(voice, .08, false);
  assert.equal(voice.left, 0); assert.equal(voice.right, 0);
  assert.ok(voice.slots.every(slot => slot.age < 0 && !slot.pending));
  assert.equal(rms(renderAccent(voice, .2).left), 0, 'rearming never replays canceled clicks');
  for (const kind of ['dice-charm', 'mushroom-gloop']) {
    voice.trigger(kind); assert.ok(rms(renderAccent(voice, .1).left) > .01);
    voice.release(); renderAccent(voice, .08);
    assert.equal(voice.left, 0); assert.equal(voice.right, 0);
  }
  voice.trigger('dice-charm'); renderAccent(voice, .01, false);
  assert.equal(rms(renderAccent(voice, .2).left), 0, 'a click received while disabled is consumed');
});

test('picture cues reach both scene mixes on the sample clock without taking an ingredient solo slot', () => {
  for (const mode of ['brew', 'flight']) for (const kind of ['dice-charm', 'mushroom-gloop']) {
    const a = new WitchDSP(8000), b = new WitchDSP(8000);
    assert.equal(a.trigger(kind), false, 'Audio must be armed separately');
    for (const dsp of [a, b]) {
      dsp.setControls({ mode, gate: false, ghostGate: false }); dsp.setEnabled(true);
      assert.equal(dsp.trigger(kind), true);
    }
    const sound = renderMix(a, .7);
    assert.deepEqual(sound, renderMix(b, .7, 5600));
    assert.ok(rms(sound) > .008, `${mode}: ${kind} reaches the shared mix`);
    assert.ok(sound.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
    assert.equal(a.drops.solo, 0); assert.equal(a.visual.dropKind, '');
    a.releaseAccents(); renderMix(a, .1);
    assert.ok(a.scene.pictureAccents.slots.every(slot => slot.age < 0));
    a.setEnabled(false); renderMix(a, 1);
    assert.ok(rms(renderMix(a, .1)) < 1e-6);
  }
});
