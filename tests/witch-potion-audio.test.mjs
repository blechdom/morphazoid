import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { WITCH_DROP_EFFECTS } from '../src/instruments/witch/witch-model.js';
import { RoachPercussion } from '../src/instruments/roach-synth/roach-synth-percussion.js';
import { RoachZing } from '../src/instruments/roach-synth/roach-synth-textures.js';
import { SpiderStrings } from '../src/instruments/spider-synth/spider-synth-string.js';
import { DEFAULT_FM_DRUM_VOICES } from '../src/instruments/fm-drums/fm-drums.js';
import { voicePresetState, glottalHarmonics, throatVoiceParameters } from '../src/families/tract/throatazoid.js';
import { WITCH_BITE_CLIPS } from '../src/instruments/witch/witch-bite-clips.js';
import { witchBiteClips } from '../src/instruments/witch/witch-scene-audio.js';

const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
function render(dsp, seconds, block = 128) {
  const data = new Float32Array(Math.round(seconds * dsp.rate));
  for (let offset = 0; offset < data.length; offset += block) dsp.process(data.subarray(offset, Math.min(data.length, offset + block)));
  return data;
}

test('every potion ingredient speaks alone without transport and finishes at low and normal sample rates', () => {
  assert.deepEqual(WITCH_DROP_EFFECTS.map(kind => kind.slice(5)).sort(),
    ['gesticules', 'marimba', 'choir', 'glass', 'tail', 'earwax', 'eyeball', 'newt', 'hair', 'roach', 'spider', 'oculoid', 'rubix', 'hiccup', 'blowhole', 'syrinx', 'throat-singing', 'julie-saw', 'puggler', 'fractal', 'synthesaurus', 'jaw-harp', 'harmonicazoid', 'dentaphone', 'blech', 'cat', 'mouse', 'lizard'].sort());
  for (const rate of [8000, 48000]) for (const kind of WITCH_DROP_EFFECTS) {
    const dsp = new WitchDSP(rate); dsp.setEnabled(true);
    assert.equal(dsp.controls.gate, false); assert.equal(dsp.trigger(kind), true);
    const sound = render(dsp, .8);
    assert.ok(rms(sound) > .006, `${kind} speaks at ${rate}`);
    assert.ok(sound.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
    render(dsp, 7);
    assert.ok(rms(render(dsp, .1)) < 1e-6, `${kind} releases at ${rate}`);
    assert.equal(dsp.visual.dropKind, '');
  }
});

test('the complete miniature palette shares exact sample-clock timing and bounded reusable engines', () => {
  const a = new WitchDSP(24000), b = new WitchDSP(24000);
  for (const dsp of [a, b]) {
    dsp.setControls({ gate: true, mode: 'flight', speed: .6 }); dsp.setEnabled(true);
    for (const kind of WITCH_DROP_EFFECTS) assert.equal(dsp.trigger(kind), true);
  }
  assert.deepEqual(render(a, 1), render(b, 1, 24000));
  assert.ok(a.drops.tastes.roach instanceof RoachPercussion);
  assert.ok(a.drops.tastes.zing instanceof RoachZing);
  assert.ok(a.drops.tastes.spider instanceof SpiderStrings);
  assert.equal(a.drops.tastes.fmDrums.voices.length, 8);
  const slots = a.drops.slots.slice(), strings = a.drops.tastes.spider.voices.slice(), fmHits = a.drops.tastes.fmDrums.voices.slice();
  for (let i = 0; i < 250; i++) a.trigger(WITCH_DROP_EFFECTS[i % WITCH_DROP_EFFECTS.length]);
  assert.ok(a.drops.slots.every((slot, index) => slot === slots[index]));
  assert.ok(a.drops.tastes.spider.voices.every((voice, index) => voice === strings[index]));
  assert.ok(a.drops.tastes.fmDrums.voices.every((voice, index) => voice === fmHits[index]));
  a.setEnabled(false); render(a, 2);
  assert.ok(rms(render(a, .1)) < 1e-6);
});

test('retriggering each new miniature crossfades from its previous sample', () => {
  for (const kind of WITCH_DROP_EFFECTS.filter(kind => kind !== 'drop-gesticules')) {
    const dsp = new WitchDSP(24000); dsp.setEnabled(true); dsp.trigger(kind);
    const left = new Float32Array(128), right = new Float32Array(128);
    for (let i = 0; i < 40; i++) dsp.drops.process(left, right);
    const lastLeft = left.at(-1), lastRight = right.at(-1);
    dsp.trigger(kind);
    dsp.drops.process(left.subarray(0, 1), right.subarray(0, 1));
    assert.ok(Math.abs(left[0] - lastLeft) < .001, `${kind} left retrigger edge`);
    assert.ok(Math.abs(right[0] - lastRight) < .001, `${kind} right retrigger edge`);
  }
});

test('Throatazoid and FM Drums excerpts retain their actual authored source identities', () => {
  const dsp = new WitchDSP(24000); dsp.setEnabled(true);
  const profiles = dsp.drops.tastes.throatProfiles;
  assert.deepEqual(profiles.map(profile => profile.id), ['clear', 'deep', 'bright']);
  for (const profile of profiles) {
    const authored = voicePresetState(profile.id);
    assert.deepEqual(profile.spectrum, glottalHarmonics(authored.exciterTenseness, 48, 1024));
    assert.deepEqual(profile.body, throatVoiceParameters(authored, 0, dsp.rate));
    assert.equal(profile.state.exciterPitch, authored.exciterPitch);
  }
  const choir = dsp.drops.slots.find(slot => slot.kind === 'drop-choir');
  assert.equal(choir.mask, 0, 'Throatazoid owns its miniature voice rather than using the generic hand choir');
  dsp.trigger('drop-choir'); const voice = render(dsp, 2.4);
  assert.ok(rms(voice.subarray(0, 8000)) > .01 && rms(voice.subarray(32000, 40000)) > .01);
  render(dsp, 4);
  dsp.trigger('drop-oculoid'); const drums = render(dsp, 2.4);
  assert.ok(rms(drums) > .01, 'the preserved legacy trigger now sounds the actual FM Drums excerpt');
  const hits = dsp.drops.tastes.fmDrums.voices;
  assert.ok(hits.every(hit => DEFAULT_FM_DRUM_VOICES.includes(hit.voice)), 'hits retain the shared factory objects');
  assert.ok(new Set(hits.map(hit => hit.voice.id)).size >= 4, 'the faster rhythm retains a varied native kit');
  assert.equal(dsp.drops.slots.find(slot => slot.kind === 'drop-oculoid').event, 27);
  assert.ok(rms(voice.map((value, index) => value - drums[index])) > .04, 'the two instrument bites have distinct signals');
  render(dsp, 5); assert.ok(rms(render(dsp, .1)) < 1e-6);
});

test('Puggler plays its finite punk drums and Oi excerpt from a shared source bank', () => {
  const dsp = new WitchDSP(24000), taste = dsp.drops.tastes.clips['drop-puggler'], data = taste.data;
  for (const rate of [8000, 48000]) assert.equal(new WitchDSP(rate).drops.tastes.clips['drop-puggler'], taste,
    'every output rate resamples the same source excerpt');
  assert.equal(taste.rate, 22050); assert.equal(data.length, Math.ceil(2.4 * taste.rate));
  assert.match(WITCH_BITE_CLIPS['drop-puggler'].source, /CC0 drums.*Oi/);
  assert.ok(data.every(value => Number.isFinite(value) && Math.abs(value) <= .680001));
  assert.equal(data[0], 0); assert.equal(data.at(-1), 0);
  assert.ok(rms(data.subarray(0, taste.rate / 2)) > .04);
  assert.ok(rms(data.subarray(taste.rate * 1.5, taste.rate * 2)) > .04);
  assert.equal(dsp.trigger('drop-puggler'), false, 'an ingredient never arms Audio');
  dsp.setEnabled(true); assert.equal(dsp.trigger('drop-puggler'), true);
  assert.ok(rms(render(dsp, .5)) > .04);
  const slot = dsp.drops.slots.find(slot => slot.kind === 'drop-puggler');
  assert.equal(slot.mask, 0, 'Puggler has its own excerpt rather than a generic hand sound');
  for (let i = 0; i < 100; i++) { dsp.trigger('drop-puggler'); render(dsp, .002); }
  assert.equal(witchBiteClips()['drop-puggler'], taste); assert.equal(taste.data, data);
  assert.equal(dsp.drops.slots.find(item => item.kind === 'drop-puggler'), slot);
  dsp.setEnabled(false); render(dsp, 2); assert.ok(rms(render(dsp, .1)) < 1e-7);
  dsp.setEnabled(true); assert.ok(rms(render(dsp, .1)) < 1e-7, 'muted excerpts never restart on rearming');
});
