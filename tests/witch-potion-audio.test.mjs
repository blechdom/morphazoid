import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { WITCH_DROP_EFFECTS } from '../src/instruments/witch/witch-model.js';
import { RoachPercussion } from '../src/instruments/roach-synth/roach-synth-percussion.js';
import { RoachZing } from '../src/instruments/roach-synth/roach-synth-textures.js';
import { DEFAULT_FM_DRUM_VOICES } from '../src/instruments/fm-drums/fm-drums.js';
import { HYPER_RUBIX_TECHNO_VOICES } from '../src/instruments/hyper-rubix/hyper-rubix.js';
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
    ['gesticules', 'marimba', 'choir', 'glass', 'tail', 'hyper-rubix', 'earwax', 'eyeball', 'newt', 'hair', 'roach', 'spider', 'oculoid', 'rubix', 'hiccup', 'blowhole', 'syrinx', 'throat-singing', 'julie-saw', 'puggler', 'fractal', 'synthesaurus', 'jaw-harp', 'harmonicazoid', 'dentaphone', 'blech', 'cat', 'mouse', 'lizard', 'quadruped', 'monstroid', 'candy-coil', 'chiptune', 'acid-303'].sort());
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
    for (const kind of WITCH_DROP_EFFECTS) assert.equal(dsp.trigger(kind), !['drop-cat', 'drop-mouse', 'drop-lizard'].includes(kind), kind);
  }
  assert.deepEqual(render(a, 1), render(b, 1, 24000));
  assert.ok(a.drops.tastes.roach instanceof RoachPercussion);
  assert.ok(a.drops.tastes.zing instanceof RoachZing);
  assert.equal(a.drops.tastes.clips['drop-spider'].instrumentId, 'spider-synth');
  assert.equal(a.drops.tastes.fmDrums.voices.length, 8);
  const slots = a.drops.slots.slice(), speech = a.drops.tastes.clips['drop-spider'], fmHits = a.drops.tastes.fmDrums.voices.slice();
  for (let i = 0; i < 250; i++) a.trigger(WITCH_DROP_EFFECTS[i % WITCH_DROP_EFFECTS.length]);
  assert.ok(a.drops.slots.every((slot, index) => slot === slots[index]));
  assert.equal(a.drops.tastes.clips['drop-spider'], speech);
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

test('the roach bite layers three native wing-flutter trains over its feet and wire rasp', () => {
  const clip = witchBiteClips()['roach-wings'];
  assert.equal(clip.instrumentId, 'roach-synth'); assert.equal(clip.events, 3);
  assert.equal(clip.frames, clip.rate * 2.4);
  assert.match(WITCH_BITE_CLIPS['roach-wings'].source, /RoachBodyEngine.*Wing radio buzz.*vivarium rustle/);
  const windowRms = (start, end) => rms(clip.data.subarray(start * clip.rate, end * clip.rate));
  const active = [[.15, .55], [.95, 1.25], [1.75, 2.15]].map(([start, end]) => windowRms(start, end));
  assert.ok(active.every(level => level > .08), 'each wing train has a usable level');
  for (const [start, end] of [[.74, .81], [1.51, 1.6]]) {
    assert.ok(windowRms(start, end) < Math.min(...active) * .05, 'flutter trains separate instead of becoming a continuous hiss');
  }
  for (const rate of [8000, 48000]) {
    const full = new WitchDSP(rate), feet = new WitchDSP(rate);
    feet.drops.tastes.roachWings = { ...clip, data: new Float32Array(clip.frames) };
    for (const dsp of [full, feet]) { dsp.setEnabled(true); dsp.trigger('drop-roach'); }
    const combined = render(full, 2.4), percussion = render(feet, 2.4);
    const difference = rms(combined.map((value, index) => value - percussion[index]));
    assert.ok(difference > rms(percussion) * .35, 'wings remain substantial beside the original percussion');
    assert.ok(rms(percussion) > rms(combined) * .5, 'feet and wire retain their place in the layered bite');
    assert.ok(combined.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
    render(full, 2); assert.ok(rms(render(full, .1)) < 1e-6);
    full.trigger('drop-roach'); render(full, .3); full.releaseAccents(); render(full, 2);
    assert.ok(rms(render(full, .1)) < 1e-6, 'Reset releases the flutter with the rest of the bite');
  }
});

test('Puggler plays its finite punk drums and Oi excerpt from a shared source bank', () => {
  const dsp = new WitchDSP(24000), taste = dsp.drops.tastes.clips['drop-puggler'], data = taste.data;
  for (const rate of [8000, 48000]) assert.equal(new WitchDSP(rate).drops.tastes.clips['drop-puggler'], taste,
    'every output rate resamples the same source excerpt');
  assert.equal(taste.rate, 22050); assert.equal(data.length, Math.ceil(2.4 * taste.rate));
  assert.match(WITCH_BITE_CLIPS['drop-puggler'].source, /punk fuzz-guitar riff, CC0 drum kit.*Oi.*224 BPM/);
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

test('Hyper Rubix drops a finite native eight-cell Hyper Kit phrase distinct from Rubix', () => {
  for (const rate of [8000, 48000]) {
    const hyper = new WitchDSP(rate), rubix = new WitchDSP(rate);
    assert.equal(hyper.trigger('drop-hyper-rubix'), false, 'the bite never arms Audio');
    for (const dsp of [hyper, rubix]) dsp.setEnabled(true);
    assert.equal(hyper.trigger('drop-hyper-rubix'), true); assert.equal(rubix.trigger('drop-rubix'), true);
    const taste = hyper.drops.tastes.hyperRubix, voices = taste.voices.slice();
    assert.equal(taste.score.length, 24); assert.equal(voices.length, 12);
    assert.deepEqual(new Set(taste.score.map(event => event.parameters.voice)), new Set(Object.values(HYPER_RUBIX_TECHNO_VOICES)));
    const sound = render(hyper, 2.4), ordinary = render(rubix, 2.4);
    assert.ok(rms(sound) > .006, `Hyper Kit speaks at ${rate}`);
    assert.ok(sound.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
    assert.ok(rms(sound.map((value, i) => value - ordinary[i])) > .01);
    assert.equal(hyper.drops.slots.find(slot => slot.kind === 'drop-hyper-rubix').event, 24);
    hyper.trigger('drop-hyper-rubix'); render(hyper, .1); hyper.releaseAccents(); render(hyper, 2);
    assert.ok(rms(render(hyper, .1)) < 1e-6, 'the full bite and its tails release');
    assert.ok(taste.voices.every((voice, i) => voice === voices[i]), 'retrigger keeps the fixed voice pool');
  }
});
