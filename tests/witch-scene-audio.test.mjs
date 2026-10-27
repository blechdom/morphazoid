import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { witchBiteClips, witchBiteVariants, WITCH_WEB_RATIOS, WitchEyeShock, WitchSceneDSP, WitchBlechFlyby, WITCH_BLECH_FRENZY_DURATION, WitchTreePhrase } from '../src/instruments/witch/witch-scene-audio.js';
import { WITCH_NATIVE_BITE_VARIANTS } from '../src/instruments/witch/witch-bite-native-variants.js';
import { WITCH_BITE_CLIPS } from '../src/instruments/witch/witch-bite-clips.js';
import { normalizeWitchControls } from '../src/instruments/witch/witch-model.js';
import { createWitchCatClock } from '../src/instruments/witch/witch-cat-model.js';
import { getWitchBlechFlyby, WITCH_BLECH_FLYBY_CYCLE, WITCH_GHOST_SCARE_DURATION } from '../src/instruments/witch/witch-scene-model.js';
import { parseBlackMidiScore } from '../src/instruments/blech-midi/blech-midi-black-score.js';

const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
const difference = (a, b) => rms(a.map((value, i) => value - b[i]));
function playing(controls = {}, rate = 12000) {
  const dsp = new WitchDSP(rate); dsp.setControls({ gate: true, speed: .55, radius: .65, ...controls }); dsp.setEnabled(true); return dsp;
}
function render(dsp, seconds, block = 128) {
  const data = new Float32Array(Math.round(dsp.rate * seconds));
  for (let i = 0; i < data.length; i += block) dsp.process(data.subarray(i, Math.min(i + block, data.length)));
  return data;
}

test('the foreground Hiccup scream is one finite sample-clock voice independent of sleeping performers', () => {
  const controls = { gate: false, ghostGate: false, brewEnabled: false, handEnabled: false, backingEnabled: false };
  const off = new WitchDSP(8000); off.setControls(controls);
  assert.equal(off.trigger('ghost-scream'), false); assert.equal(off.visual.ghostScreamActive, false);
  const a = playing(controls, 8000), b = playing(controls, 8000);
  assert.equal(a.trigger('ghost-scream'), true); assert.equal(b.trigger('ghost-scream'), true);
  assert.equal(a.visual.ghostScreamAge, 0); assert.equal(a.visual.ghostScreamActive, true);
  const voice = a.ghostScream, formants = voice.formants.slice();
  const onset = render(a, .2);
  assert.deepEqual(onset, render(b, .2, 1600), 'the scream never depends on display or render block size');
  assert.ok(rms(onset) > .005 && onset.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  assert.ok(Math.abs(a.visual.ghostScreamAge - .2) < 1e-9); assert.ok(a.visual.ghostScreamEnvelope > .8);
  assert.equal(a.visual.brewLevel, 0); assert.equal(a.visual.handLevel, 0); assert.equal(a.visual.ghostLevel, 0);
  const age = a.visual.ghostScreamAge;
  for (let i = 0; i < 100; i++) assert.equal(a.trigger('ghost-scream'), false, 'busy clicks do not stack or extend the scare');
  assert.equal(a.ghostScream, voice); assert.deepEqual(voice.formants, formants); assert.equal(a.visual.ghostScreamAge, age);
  assert.deepEqual(render(a, WITCH_GHOST_SCARE_DURATION - .2), render(b, WITCH_GHOST_SCARE_DURATION - .2, 20000));
  assert.equal(a.visual.ghostScreamActive, false); assert.equal(a.visual.ghostScreamAge, WITCH_GHOST_SCARE_DURATION);
  assert.equal(a.visual.ghostScreamEnvelope, 0); assert.equal(rms(render(a, .1)), 0);
  assert.equal(a.trigger('ghost-scream'), true, 'a later accepted visit reuses the same voice');
  assert.equal(a.ghostScream, voice);
});

test('the Hiccup scream joins witch flight echoes, bypasses Fabric and releases on Stop, mute and accent cancellation', () => {
  const controls = { mode: 'flight', gate: true, ghostGate: false, brewEnabled: false, handEnabled: false,
    backingEnabled: false, trailPull: .04, trailSpace: .2 };
  const plain = playing(controls, 8000), cloth = playing({ ...controls, fabricX: .04, fabricY: .97, fabricPull: 1 }, 8000);
  plain.trigger('ghost-scream'); cloth.trigger('ghost-scream');
  assert.deepEqual(render(plain, .8), render(cloth, .8), 'only the separate wind enters Fabric');
  assert.ok(plain.visual.delayLevel > .001, 'the scream reaches Candy Coil and Sandy Syrup');
  assert.equal(plain.visual.fabricWindEnvelope, 0);
  for (const cancel of [dsp => dsp.setControls({ gate: false }), dsp => dsp.releaseAccents(), dsp => dsp.setEnabled(false)]) {
    const dsp = playing(controls, 8000); dsp.trigger('ghost-scream'); render(dsp, .18);
    cancel(dsp);
    assert.ok(rms(render(dsp, .01)) > .001, 'cancellation releases without a hard cut');
    render(dsp, .06); assert.equal(dsp.visual.ghostScreamActive, false); assert.equal(dsp.visual.ghostScreamEnvelope, 0);
    render(dsp, 6); assert.ok(rms(render(dsp, .1)) < 1e-6, 'the voice and its echoes finish');
  }
});

test('BLECH flybys share a sparse icon and native-phrase clock with two bounded voices', () => {
  assert.deepEqual(getWitchBlechFlyby(4.99), []);
  assert.equal(getWitchBlechFlyby(5.3).length, 1);
  assert.equal(getWitchBlechFlyby(18.5).length, 2);
  assert.deepEqual(getWitchBlechFlyby(Infinity), []);
  const first = getWitchBlechFlyby(5.3)[0], repeated = getWitchBlechFlyby(WITCH_BLECH_FLYBY_CYCLE + 5.3)[0];
  assert.ok(Math.abs(first.x - repeated.x) < 1e-9); assert.notEqual(first.id, repeated.id);
  const flyby = new WitchBlechFlyby(8000), pool = flyby.slots.slice(), controls = { mode: 'flight', ghostGate: true };
  assert.equal(flyby.clip, witchBiteClips()['drop-blech'], 'the actual BLECH phrase is shared, not synthesized again');
  for (const [index, clip] of WITCH_NATIVE_BITE_VARIANTS['drop-blech'].entries()) {
    const midi = readFileSync(new URL(`../${clip.midiFile}`, import.meta.url));
    const score = parseBlackMidiScore(midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength));
    let attacks = 0;
    for (let i = 0; i < score.total; i++) if (score.starts[i] >= clip.sourceStart && score.starts[i] < clip.sourceEnd) attacks++;
    assert.equal(clip.events, attacks, 'every original attack in the dense passage is retained');
    assert.equal(witchBiteVariants()['drop-blech'][index].events, attacks);
    assert.ok(attacks > 4000); assert.match(clip.source, /BLEEDING EDGE MONOTONE.*native SpessaSynth/);
    assert.equal(clip.license, 'CC0-1.0');
  }
  let energy = 0, peak = 0, pairs = 0;
  for (let i = 0; i < 8000 * 27; i++) {
    flyby.next(controls, true); energy += flyby.left ** 2 + flyby.right ** 2;
    peak = Math.max(peak, Math.abs(flyby.left), Math.abs(flyby.right));
    if (flyby.slots.every(slot => slot.age >= 0)) pairs++;
  }
  assert.ok(energy > 1 && peak < .13 && pairs > 8000, 'the pair overlaps at a quiet, finite level');
  assert.ok(flyby.slots.every((slot, i) => slot === pool[i]));
  assert.equal(flyby.left, 0); assert.equal(flyby.right, 0);
});

test('BLECH flight sound follows the sample clock without potion solos, muted backlog or resumed attacks', () => {
  const make = () => playing({ mode: 'flight', ghostGate: true }, 8000);
  const a = make(), b = make(), reference = make();
  for (const dsp of [a, b]) dsp.syncPhase(0, 0, undefined, undefined, undefined, undefined, undefined, 4.9);
  reference.syncPhase(0, 0);
  const sound = render(a, .8);
  assert.deepEqual(sound, render(b, .8, 6400));
  assert.ok(difference(sound, render(reference, .8)) > .003, 'the native phrase reaches the shared flight mix');
  assert.equal(a.chantPhase, reference.chantPhase); assert.equal(a.visual.handTime, reference.visual.handTime);
  assert.equal(a.drops.solo, 0); assert.equal(a.visual.dropKind, ''); assert.equal(a.visual.dropLevel, 0);
  assert.ok(Math.abs(getWitchBlechFlyby(a.visual.flybyTime)[0].age - a.blechFlyby.slots[0].age) < 1 / a.rate);
  a.setControls({ ghostGate: false, gate: false }); const held = a.visual.flybyTime;
  render(a, .1); render(a, .1); assert.equal(a.visual.flybyTime, held); assert.equal(a.visual.flybyLevel, 0);
  a.setControls({ ghostGate: true }); render(a, .1); assert.equal(a.visual.flybyLevel, 0, 'Release does not retrigger a frozen entrance');
  a.setEnabled(false); a.syncPhase(0, 0, undefined, undefined, undefined, undefined, undefined, 15.9);
  render(a, .5); a.setEnabled(true); render(a, .4); assert.equal(a.visual.flybyLevel, 0, 'Audio on skips a phrase that entered while muted');
  a.syncPhase(0, 0, undefined, undefined, undefined, undefined, undefined, 18.1);
  render(a, .5); assert.ok(a.visual.flybyLevel > .001);
  a.setControls({ mode: 'brew' }); const landed = a.visual.flybyTime;
  render(a, .1); render(a, .1); assert.equal(a.visual.flybyTime, landed); assert.equal(a.visual.flybyLevel, 0);
  a.setControls({ mode: 'flight' }); a.syncPhase(0, 0, undefined, undefined, undefined, undefined, undefined, 4.9);
  render(a, .5); a.releaseAccents(); render(a, .1); render(a, .1); assert.equal(a.visual.flybyLevel, 0);
  assert.ok(sound.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
});

test('clicked BLECH visitors repeat their actual hardcore demo in one bounded accelerated three-reader burst', () => {
  const rate = 8000, controls = { mode: 'flight', ghostGate: true };
  for (let variant = 0; variant < 3; variant++) {
    const flyby = new WitchBlechFlyby(rate), readers = flyby.frenzyReaders.slice();
    flyby.nextVariant = variant; flyby.syncTime(4.99);
    for (let i = 0; i < rate * .15; i++) flyby.next(controls, true);
    const clock = flyby.time, nextVariant = flyby.nextVariant, clip = flyby.slots[0].clip;
    assert.equal(clip, witchBiteVariants()['drop-blech'][variant]);
    assert.equal(flyby.triggerFrenzy(0), true); assert.equal(flyby.frenzy.clip, clip);
    let energy = 0, peak = 0, tail = 0;
    for (let i = 0; i < Math.ceil((WITCH_BLECH_FRENZY_DURATION + .1) * rate); i++) {
      // Direct clicking remains playable with the automatic backing asleep.
      flyby.next({ ...controls, ghostGate: false }, false, true);
      const left = flyby.frenzyLeft, right = flyby.frenzyRight;
      assert.ok(Number.isFinite(left) && Number.isFinite(right));
      energy += left * left + right * right; peak = Math.max(peak, Math.abs(left), Math.abs(right));
      if (i > (WITCH_BLECH_FRENZY_DURATION + .02) * rate) tail += left * left + right * right;
    }
    assert.ok(energy > .1 && peak < .13, 'dense layers retain the existing flyby headroom');
    assert.ok(flyby.frenzy.loops >= 7, 'three accelerated native readers repeatedly traverse the actual demo');
    assert.equal(tail, 0); assert.equal(flyby.frenzyEnvelope, 0); assert.equal(flyby.frenzy.age, -1);
    assert.equal(flyby.time, clock); assert.equal(flyby.nextVariant, nextVariant, 'manual looping cannot consume the next autonomous demo');
    assert.ok(flyby.frenzyReaders.every((reader, index) => reader === readers[index]));
  }
});

test('BLECH frenzy is a sample-clock manual accent independent of the sleeping voice, hand and animal loops', () => {
  const controls = { mode: 'flight', gate: false, ghostGate: false, brewEnabled: false, handEnabled: false, backingEnabled: false };
  const off = new WitchDSP(8000); off.setControls(controls);
  assert.equal(off.trigger('blech-frenzy', undefined, { flybyIndex: 0 }), false);
  const grounded = playing({ ...controls, mode: 'brew' }, 8000);
  assert.equal(grounded.trigger('blech-frenzy', undefined, { flybyIndex: 0 }), false);
  const a = playing(controls, 8000), b = playing({ ...controls, fabricPull: 1, fabricX: .1, fabricY: .9 }, 8000);
  assert.equal(a.trigger('blech-frenzy', undefined, { flybyIndex: 2 }), false);
  for (const dsp of [a, b]) assert.equal(dsp.trigger('blech-frenzy', undefined, { flybyIndex: 1 }), true);
  const sound = render(a, .7);
  assert.deepEqual(sound, render(b, .7, 5600), 'native loops depend on audio samples and bypass the wind-only Fabric');
  assert.ok(rms(sound) > .008); assert.ok(sound.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  assert.equal(a.visual.flybyFrenzyIndex, 1); assert.equal(a.visual.flybyFrenzy, 1);
  assert.ok(a.visual.flybyLevel > .001 && a.visual.delayLevel > .001, 'the direct burst reaches the normal flight delay');
  for (const field of ['brewLevel', 'handLevel', 'ghostLevel', 'catLevel', 'dropLevel']) assert.equal(a.visual[field], 0, field);
  assert.equal(a.visual.fabricWindEnvelope, 0); assert.equal(a.cat.triggerCount, 0);
  assert.ok(a.visitors.visitors.every(visitor => visitor.triggerCount === 0));
  assert.equal(a.controls.backingEnabled, false); assert.equal(a.controls.gate, false);
});

test('BLECH frenzy coalesces busy clicks and releases on landing, Stop, mute and accent cancellation', () => {
  const controls = { mode: 'flight', gate: true, ghostGate: true, brewEnabled: false, handEnabled: false, backingEnabled: false };
  const busy = playing(controls, 8000), readers = busy.blechFlyby.frenzyReaders.slice();
  busy.trigger('blech-frenzy', undefined, { flybyIndex: 0 }); render(busy, .2);
  for (let i = 0; i < 100; i++) assert.equal(busy.trigger('blech-frenzy', undefined, { flybyIndex: i % 2 }), true);
  assert.equal(busy.blechFlyby.frenzy.pendingIndex, 1);
  const restart = render(busy, .08);
  assert.ok(restart.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  assert.equal(busy.visual.flybyFrenzyIndex, 1); assert.equal(busy.blechFlyby.frenzy.pendingIndex, -1);
  assert.ok(busy.blechFlyby.frenzyReaders.every((reader, index) => reader === readers[index]));
  for (const cancel of [dsp => dsp.setControls({ mode: 'brew' }), dsp => dsp.setControls({ gate: false }),
    dsp => dsp.setEnabled(false), dsp => dsp.releaseAccents()]) {
    const dsp = playing(controls, 8000); dsp.trigger('blech-frenzy', undefined, { flybyIndex: 0 }); render(dsp, .2);
    dsp.trigger('blech-frenzy', undefined, { flybyIndex: 1 }); cancel(dsp);
    assert.ok(rms(render(dsp, .01)) > .001, 'release preserves the current wave rather than hard cutting');
    render(dsp, .1);
    assert.equal(dsp.visual.flybyFrenzy, 0); assert.equal(dsp.blechFlyby.frenzy.age, -1);
    assert.equal(dsp.blechFlyby.frenzy.pendingIndex, -1); assert.equal(dsp.visual.flybyLevel, 0);
    render(dsp, 6); assert.ok(rms(render(dsp, .1)) < 1e-6, 'native burst and its flight echoes finish');
  }
});

test('baked native instrument phrases form a bounded, shared source bank with distinct audible bites', () => {
  const clips = witchBiteClips(); assert.equal(witchBiteClips(), clips);
  assert.deepEqual(Object.keys(clips), [...Object.keys(WITCH_BITE_CLIPS), 'drop-quadruped']);
  assert.equal(clips['drop-quadruped'], clips['drop-cat'], 'the second Quadruped gesture shares PCM storage');
  let bytes = 0;
  const signals = [], unique = new Set();
  for (const [kind, clip] of Object.entries(clips)) {
    if (!unique.has(clip)) bytes += clip.data.byteLength;
    assert.equal(clip.frames, clip.data.length); assert.equal(clip.rate, 22050);
    assert.ok(clip.data.every(value => Number.isFinite(value) && Math.abs(value) <= .65001));
    assert.equal(clip.data[0], 0); assert.equal(clip.data.at(-1), 0);
    assert.ok(rms(clip.data) > .04, `${kind}: authored dynamics retain usable source level`);
    const dsp = playing({ gate: false }); assert.equal(dsp.trigger(kind === 'roach-wings' ? 'drop-roach' : kind), true);
    const signal = render(dsp, .8); assert.ok(rms(signal) > .006, kind);
    if (!unique.has(clip)) signals.push(signal);
    unique.add(clip);
  }
  assert.ok(bytes < 4_500_000, 'the native chip, acid and speech excerpts fit a 4.5 MB decoded budget; the cat alias adds no bytes');
  for (let i = 0; i < signals.length; i++) for (let j = 0; j < i; j++) assert.ok(difference(signals[i], signals[j]) > .015);
});

test('tree instruments keep playing through the perch phrase and dive while normal bites finish sooner', () => {
  for (const kind of ['drop-blech', 'drop-syrinx', 'drop-eyeball']) {
    const dsp = playing({ gate: false }); dsp.trigger(kind); render(dsp, 3.2);
    assert.ok(rms(render(dsp, .8)) > .005, `${kind}: phrase continues during the dive`);
    assert.equal(dsp.visual.dropKind, kind); render(dsp, 4);
    assert.ok(rms(render(dsp, .1)) < 1e-6);
  }
  const ordinary = playing({ gate: false }); ordinary.trigger('drop-fractal'); render(ordinary, 4);
  assert.ok(rms(render(ordinary, .1)) < 1e-6);
});

test('the falling spider speaks through its native clip while the web stays silent', () => {
  const dsp = playing({ gate: false }, 8000);
  const clip = witchBiteClips()['drop-spider'];
  assert.equal(clip.instrumentId, 'spider-synth');
  assert.equal(WITCH_BITE_CLIPS['drop-spider'].text, 'NOOOOOOOOO !!!!!');
  assert.equal(dsp.trigger('drop-spider'), true);
  assert.ok(rms(render(dsp, 1.18)) > .02, 'the stretched protest is present');
  assert.ok(rms(render(dsp, 1.1)) > .02, 'the long protest remains audible through the fall');
  assert.equal(dsp.scene.groan, 0);
  assert.ok(dsp.scene.web.voices.every(voice => voice.remaining <= 0));
  render(dsp, 2);
  assert.ok(rms(render(dsp, .1)) < 1e-7, 'speech releases without an endless web tail');
});

test('tree click plays one branching PM phrase through the scene mix with finite release', () => {
  const off = new WitchDSP(8000); assert.equal(off.trigger('tree-l-system'), false);
  const a = playing({ gate: false }, 8000), b = playing({ gate: false }, 8000);
  for (const dsp of [a, b]) assert.equal(dsp.trigger('tree-l-system'), true);
  const sound = render(a, .8); assert.deepEqual(sound, render(b, .8, 6400));
  assert.ok(rms(sound) > .02); assert.ok(a.visual.treeEnvelope > .25); assert.ok(a.visual.treeLevel > .005);
  assert.ok(a.visual.treeProgress>0&&a.visual.treeProgress<1, 'branch light follows an active audio playhead');
  assert.equal(a.drops.solo, 0); assert.equal(a.visual.dropKind, ''); assert.equal(a.visual.dropLevel, 0);
  render(a, 2); assert.equal(a.visual.treeEnvelope, 0); assert.ok(rms(render(a, .1)) < 1e-7);
  const tree = a.scene.tree, controls = JSON.stringify(a.controls);
  for (let i = 0; i < 80; i++) { assert.equal(a.trigger('tree-l-system'), i === 0); render(a, .004); }
  assert.equal(a.scene.tree, tree); assert.equal(JSON.stringify(a.controls), controls);
  assert.ok(render(a, .2).every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  for (const cancel of [dsp => dsp.releaseAccents(), dsp => dsp.setControls({ gate: false, ghostGate: false }), dsp => dsp.setEnabled(false)]) {
    a.setEnabled(true); a.setControls({ gate: true, ghostGate: true }); a.trigger('tree-l-system'); render(a, .3);
    cancel(a); render(a, .1); render(a, .05); assert.equal(a.visual.treeLevel, 0); assert.equal(a.visual.treeEnvelope, 0);
  }
  assert.equal(a.trigger('tree-l-system'), false); a.setEnabled(true); render(a, .2); assert.equal(a.visual.treeLevel, 0);
  const plain = playing({ mode: 'flight' }, 8000), filtered = playing({ mode: 'flight', fabricX: .04, fabricY: .94 }, 8000);
  plain.trigger('tree-l-system'); filtered.trigger('tree-l-system');
  assert.deepEqual(render(plain, .7), render(filtered, .7), 'cloth settings leave the tree phrase and witch ensemble unchanged');
  assert.equal(plain.chantPhase, filtered.chantPhase); assert.equal(plain.visual.handTime, filtered.visual.handTime);
});

test('tree branch audio controls default neutral and normalize malformed or out-of-range gestures', () => {
  for (const key of ['treeSpread', 'treeCurl']) {
    assert.equal(normalizeWitchControls()[key], .5);
    for (const value of [undefined, NaN, Infinity, 'bad']) assert.equal(normalizeWitchControls({ [key]: value })[key], .5);
    assert.equal(normalizeWitchControls({ [key]: -2 })[key], 0);
    assert.equal(normalizeWitchControls({ [key]: 9 })[key], 1);
    assert.equal(normalizeWitchControls({ [key]: '.3' })[key], .3);
  }
});

test('live branch edits bend PM depth and ratio without seeking, restarting or losing a finite release', () => {
  const held = new WitchTreePhrase(8000), bent = new WitchTreePhrase(8000);
  held.trigger(); bent.trigger();
  for (let i = 0; i < 1200; i++) { held.next(true); bent.next(true); assert.equal(held.left, bent.left); }
  const cursor = bent.cursor, age = bent.age, voices = bent.voices.slice(), onsets = bent.onsets;
  bent.setControls(1, 1);
  assert.equal(bent.cursor, cursor); assert.equal(bent.age, age); assert.equal(bent.onsets, onsets);
  let differenceEnergy = 0, largestIndexStep = 0;
  for (let i = 0; i < 4000; i++) {
    const before = bent.cursor, previousIndex = bent.modulationIndex;
    held.next(true); bent.next(true);
    differenceEnergy += (held.left - bent.left) ** 2 + (held.right - bent.right) ** 2;
    assert.ok(Math.abs(bent.cursor - before - bent.dt) < 1e-12, 'geometry edits do not speed up or rewind the phrase');
    largestIndexStep = Math.max(largestIndexStep, Math.abs(bent.modulationIndex - previousIndex));
  }
  assert.ok(differenceEnergy > .01, 'branch motion changes the rendered phrase');
  assert.ok(largestIndexStep < .01 && bent.modulationIndex > 7.999, 'PM depth reaches eight through a short slew');
  assert.ok(bent.voices[0].ratio > 1.949, 'turn asymmetry changes the live modulator ratio');
  assert.equal(bent.age, held.age, 'the elapsed gesture clock does not seek with pitch');
  assert.ok(bent.voices.every((voice, index) => voice === voices[index]), 'edits retain the fixed voice bank');
  bent.release(); for (let i = 0; i < 400; i++) bent.next(true);
  assert.equal(bent.left, 0); assert.equal(bent.right, 0); assert.equal(bent.age, -1);
  bent.setControls(0, 0); bent.trigger();
  for (let i = 0; i < 32000; i++) {
    bent.next(true);
    assert.ok(Number.isFinite(bent.left) && Number.isFinite(bent.right));
    assert.ok(bent.modulationIndex >= 3 && bent.modulationIndex <= 8);
  }
  assert.equal(bent.age, -1, 'the phrase ends without another trigger');
  assert.equal(bent.left, 0); assert.equal(bent.right, 0);
});

test('branch spread and curl reach the scene sound as PM timbre, pitch and modest stereo motion', () => {
  const phrase = controls => {
    const dsp = playing({ gate: false, ...controls }, 8000);
    dsp.trigger('tree-l-system');
    const left = new Float32Array(6400), right = new Float32Array(6400);
    dsp.process(left, right);
    return { dsp, left, right };
  };
  const neutral = phrase({}), narrow = phrase({ treeSpread: 0 }), wide = phrase({ treeSpread: 1 });
  const leftCurl = phrase({ treeCurl: 0 }), rightCurl = phrase({ treeCurl: 1 });
  for (const variant of [narrow, wide, leftCurl, rightCurl]) {
    assert.ok(difference(neutral.left, variant.left) + difference(neutral.right, variant.right) > .01);
    assert.equal(variant.dsp.drops.solo, 0, 'branch motion uses its independent scene voice');
    assert.ok(variant.left.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
    variant.dsp.setEnabled(false); render(variant.dsp, .2);
    assert.equal(variant.dsp.visual.treeEnvelope, 0); assert.ok(rms(render(variant.dsp, .1)) < 1e-7);
  }
  assert.ok(rms(leftCurl.left) / rms(leftCurl.right) > rms(neutral.left) / rms(neutral.right));
  assert.ok(rms(rightCurl.left) / rms(rightCurl.right) < rms(neutral.left) / rms(neutral.right));
});

test('Rubix plays its native fast 3D Acid bank, FM Drums retains its pool and Rattlesnake cascades', () => {
  const dsp = playing({ gate: false }); dsp.trigger('drop-rubix'); render(dsp, 2.4);
  const rubix = witchBiteClips()['drop-rubix'];
  assert.equal(dsp.drops.slots.find(s => s.kind === 'drop-rubix').clip, rubix);
  assert.equal(rubix.instrumentId, 'rubix'); assert.ok(rubix.events > 100);
  assert.match(WITCH_BITE_CLIPS['drop-rubix'].source, /native RubixSimd303Processor.*Acid bank/);
  assert.ok(rms(rubix.data.subarray(rubix.rate, rubix.rate * 2)) > .04, 'the fast Acid phrase continues through the fall');
  dsp.trigger('drop-oculoid'); render(dsp, 2.4);
  assert.equal(dsp.drops.slots.find(s => s.kind === 'drop-oculoid').event, 27);
  const snake = witchBiteClips()['drop-marimba'];
  assert.equal(snake.instrumentId, 'linear-drums'); assert.equal(snake.events, 36);
  assert.ok(rms(snake.data.subarray(snake.rate, snake.rate * 1.9)) > .04, 'the cascade continues through the fall');
});

test('new cupboard Monstroid and Candy Coil tastes use native authored excerpts and release independently', () => {
  for (const [kind, instrument, source] of [
    ['drop-monstroid', 'monstroid', /native ColonySyrinxPressureProcessor/],
    ['drop-candy-coil', 'candy-coil-delay', /native MorphazoidBarberDelayProcessor.*Frozen Bog/],
  ]) {
    const clip = witchBiteClips()[kind]; assert.equal(clip.instrumentId, instrument);
    assert.match(WITCH_BITE_CLIPS[kind].source, source);
    const dsp = playing({ gate: false }, 8000); assert.equal(dsp.trigger(kind), true);
    const signal = render(dsp, 1); assert.ok(rms(signal) > .02);
    dsp.releaseAccents(); render(dsp, 1); assert.ok(rms(render(dsp, .1)) < 1e-6);
  }
});

test('every web strand plucks a distinct finite low string; groan and web remain bounded through spam, Stop and mute', () => {
  assert.equal(WITCH_WEB_RATIOS.length, 7); const signals = [];
  for (const kind of [...WITCH_WEB_RATIOS.map((_, i) => `web-${i}`), 'spider-groan']) {
    const off = new WitchDSP(12000); assert.equal(off.trigger(kind), false);
    const dsp = playing({ gate: false }); assert.equal(dsp.trigger(kind), true);
    const signal = render(dsp, .7); assert.ok(rms(signal) > .002, kind); signals.push(signal);
    render(dsp, 5); assert.ok(rms(render(dsp, .1)) < 1e-6, kind);
  }
  for (let i = 0; i < signals.length; i++) for (let j = 0; j < i; j++) assert.ok(difference(signals[i], signals[j]) > .001);
  const dsp = playing({ mode: 'flight' }), pool = dsp.scene.web.voices.slice();
  for (let i = 0; i < 100; i++) { dsp.trigger(`web-${i % 7}`); dsp.trigger('spider-groan'); }
  assert.ok(dsp.scene.web.voices.every((v, i) => v === pool[i]));
  assert.ok(render(dsp, .5).every(v => Number.isFinite(v) && Math.abs(v) <= .840001));
  dsp.setControls({ gate: false }); render(dsp, 9); assert.ok(rms(render(dsp, .1)) < 1e-6);
  dsp.trigger('web-4'); render(dsp, .1); dsp.setEnabled(false); render(dsp, 2); assert.ok(rms(render(dsp, .1)) < 1e-7);
});

test('web plucks put their energy into the first stroke while retaining a quieter creaking tail', () => {
  for (const rate of [12000, 48000]) for (const seed of [0x3453b719, 0x615a7b9, 0x1548991]) {
    for (const strand of [0, 3, 6]) {
      const scene = new WitchSceneDSP(rate); scene.web.randomState = seed;
      assert.equal(scene.trigger(`web-${strand}`), true);
      const sound = new Float32Array(rate);
      let peak = 0;
      for (let frame = 0; frame < sound.length; frame++) {
        scene.next(true); sound[frame] = (scene.left + scene.right) * .5;
        peak = Math.max(peak, Math.abs(scene.left), Math.abs(scene.right));
        assert.ok(Number.isFinite(scene.left) && Number.isFinite(scene.right));
      }
      const stroke = rms(sound.subarray(0, rate * .035));
      const tail = rms(sound.subarray(rate * .12, rate * .2));
      assert.ok(stroke > tail * 1.5, 'short strokes have an immediate attack instead of a delayed swell');
      assert.ok(tail > .008 && peak < .22, 'the low native string remains audible with restrained headroom');
    }
  }
});

test('web strums schedule every crossing, including repeated strands, as overlapping sample-clock plucks', () => {
  for (const rate of [8000, 48000]) {
    const queued = new WitchSceneDSP(rate), reference = new WitchSceneDSP(rate);
    const strands = [0, 1, 1, 3, 4, 4, 6, 2], interval = .0125;
    const pool = queued.web.voices.slice();
    assert.equal(queued.trigger('web-strum', { indices: strands, interval }), true);
    let peak = 0, overlapped = false;
    for (let frame = 0; frame < rate * 1.5; frame++) {
      const index = frame / Math.round(interval * rate);
      if (Number.isInteger(index) && index < strands.length) reference.trigger(`web-${strands[index]}`);
      queued.next(true); reference.next(true);
      assert.equal(queued.left, reference.left); assert.equal(queued.right, reference.right);
      assert.ok(Number.isFinite(queued.left) && Number.isFinite(queued.right));
      peak = Math.max(peak, Math.abs(queued.left), Math.abs(queued.right));
      overlapped ||= queued.web.active > 1;
    }
    assert.equal(queued.web.attackOrder, strands.length, 'no adjacent or repeated strand is coalesced');
    assert.ok(overlapped && peak > .05 && peak < .5);
    assert.equal(queued.webQueueCount, 0); assert.equal(queued.web.active, 0);
    assert.ok(queued.web.voices.every((voice, index) => voice === pool[index]));
  }
});

test('web strum backlog is short and bounded; release or mute cancels every pending crossing', () => {
  const rate = 8000, scene = new WitchSceneDSP(rate), pool = scene.web.voices.slice();
  for (const detail of [undefined, {}, { indices: '123' }, { indices: [-1, 7, .5, NaN] }]) {
    assert.equal(scene.trigger('web-strum', detail), false);
  }
  const gesture = { indices: [0, 1, 2, 3, 4, 5, 6, 0], interval: .008 };
  for (let i = 0; i < 1000; i++) scene.trigger('web-strum', gesture);
  let peak = 0;
  for (let frame = 0; frame < rate * .15; frame++) {
    scene.next(true); peak = Math.max(peak, Math.abs(scene.left), Math.abs(scene.right));
    assert.ok(Number.isFinite(scene.left) && Number.isFinite(scene.right));
  }
  const attacks = scene.web.attackOrder;
  assert.ok(attacks >= 8 && attacks <= 24); assert.equal(scene.webQueueCount, 0);
  for (let frame = 0; frame < rate * .5; frame++) scene.next(true);
  assert.equal(scene.web.attackOrder, attacks, 'an overloaded drag cannot leave a delayed flurry');
  assert.ok(peak < .5); assert.ok(scene.web.voices.every((voice, index) => voice === pool[index]));
  for (const muted of [false, true]) {
    const stopped = new WitchSceneDSP(rate);
    stopped.trigger('web-strum', gesture);
    for (let frame = 0; frame < rate * .02; frame++) stopped.next(true);
    const started = stopped.web.attackOrder;
    if (muted) stopped.next(false); else stopped.releaseAll();
    for (let frame = 0; frame < rate * .6; frame++) stopped.next(!muted);
    assert.equal(stopped.web.attackOrder, started); assert.equal(stopped.webQueueCount, 0);
    assert.ok(Math.abs(stopped.left) < 1e-7 && Math.abs(stopped.right) < 1e-7);
    stopped.next(true); assert.equal(stopped.web.attackOrder, started, 'Audio resume cannot replay canceled crossings');
  }
});

test('eye shock tears the complete mix for a finite gesture while retaining clocks and exact unaffected audio afterward', () => {
  for (const controls of [{}, { mode: 'flight' }, { fabricX: .05, fabricY: .95 }]) {
    const shocked = playing(controls), held = playing(controls);
    shocked.trigger('drop-synthesaurus'); held.trigger('drop-synthesaurus');
    render(shocked, .3); render(held, .3); shocked.trigger('eye-shock');
    assert.ok(difference(render(shocked, .8), render(held, .8)) > .025);
    assert.ok(shocked.visual.shockEnvelope > .1);
    assert.equal(shocked.chantPhase, held.chantPhase); assert.equal(shocked.visual.handTime, held.visual.handTime);
    render(shocked, .9); render(held, .9); assert.equal(shocked.visual.shockEnvelope, 0);
    assert.deepEqual(render(shocked, .2), render(held, .2), 'shock does not contaminate continuing effects or clocks');
  }
  const a = playing({ mode: 'flight' }), b = playing({ mode: 'flight' }); a.trigger('eye-shock'); b.trigger('eye-shock');
  assert.deepEqual(render(a, 2), render(b, 2, 24000));
  const buffer = a.shock.bufferL;
  for (let i = 0; i < 100; i++) { a.trigger('eye-shock'); render(a, .004); }
  assert.equal(a.shock.bufferL, buffer); a.setControls({ gate: false }); render(a, .08); assert.equal(a.visual.shockEnvelope, 0);
  a.trigger('eye-shock'); a.setEnabled(false); render(a, .1); assert.equal(a.visual.shockEnvelope, 0);
});

test('electrical retriggers preserve a continuous effect envelope on a steady input', () => {
  const shock = new WitchEyeShock(12000); shock.trigger();
  let envelope = 0, largest = 0;
  for (let i = 0; i < 12000 * 2; i++) {
    if (i % 1700 === 0) shock.trigger();
    shock.next(.1, .08, true); largest = Math.max(largest, Math.abs(shock.envelope - envelope)); envelope = shock.envelope;
    assert.ok(Number.isFinite(shock.left) && Math.abs(shock.left) < .4);
  }
  assert.ok(largest < .012, 'coalesced retriggers fade before beginning another shock');
});

test('explicit accent release works while already stopped, fades smoothly, and permits fresh gestures', () => {
  const released = playing({ gate: false, ghostGate: false }, 8000), held = playing({ gate: false, ghostGate: false }, 8000);
  for (const dsp of [released, held]) {
    for (const kind of ['drop-blech', 'drop-cat', 'web-2', 'spider-groan', 'eye-shock', 'moan', 'moon', 'launch']) assert.equal(dsp.trigger(kind), true);
    render(dsp, .18);
  }
  const controls = released.controls, time = released.time, phase = released.chantPhase;
  released.releaseAccents();
  assert.equal(released.controls, controls); assert.equal(released.enabled, true);
  assert.equal(released.time, time); assert.equal(released.chantPhase, phase);
  assert.ok(Math.abs(render(released, 1 / released.rate)[0] - render(held, 1 / held.rate)[0]) < .005, 'the cancellation boundary has no hard cut');
  assert.ok(rms(render(released, .02)) > .001, 'existing sound releases instead of disappearing');
  render(released, 2);
  assert.ok(rms(render(released, .1)) < 1e-6, 'Reset can finish manual accents without a Play gate edge');
  assert.ok(released.brew.effects.every(e => e.age >= e.duration));
  assert.ok(released.flight.voices.every(v => v.age >= v.duration));
  assert.equal(released.flight.launch.active, false); assert.equal(released.visual.shockEnvelope, 0);
  assert.equal(released.scene.active, 0); assert.ok(released.drops.slots.every(slot => slot.until < 0));
  assert.equal(released.trigger('moan'), true); assert.equal(released.trigger('moon'), true);
  assert.ok(rms(render(released, .3)) > .005, 'fresh accents do not inherit a canceled release state');
});

test('explicit accent release leaves live singer, fingers and visitor clocks running', () => {
  const released = playing({ ghostGate: true }, 8000), held = playing({ ghostGate: true }, 8000);
  for (const dsp of [released, held]) {
    dsp.syncPhase(0, .55, 3, .5, 2, 5, createWitchCatClock(33));
    dsp.trigger('meow'); dsp.trigger('launch'); render(dsp, .1);
  }
  released.releaseAccents(); render(released, .1); render(held, .1);
  assert.equal(released.chantPhase, held.chantPhase); assert.equal(released.visual.handTime, held.visual.handTime);
  assert.equal(released.cat.time, held.cat.time); assert.equal(released.visual.ghostPhase, held.visual.ghostPhase);
  assert.equal(released.cat.meow.active, false); assert.equal(released.cat.meow.pending, false);
  assert.ok(released.visual.brewLevel > .001 && released.visual.handLevel > .001);
});

test('a new web pluck cannot revive a canceled spider groan', () => {
  const scene = new WitchSceneDSP(8000); scene.trigger('spider-groan');
  for (let i = 0; i < 2000; i++) scene.next(true);
  assert.ok(scene.groanAge < 1.6);
  scene.releaseAll(); scene.trigger('web-4');
  for (let i = 0; i < 400; i++) scene.next(true);
  assert.equal(scene.groan, 0); assert.equal(scene.groanRelease, 0);
  assert.ok(scene.active > 2 && scene.gain > .9, 'the new web sound remains active');
  scene.trigger('spider-groan');
  for (let i = 0; i < 400; i++) scene.next(true);
  assert.ok(scene.groanAge < .1 && scene.groanRelease === 1, 'an explicit new groan still works');
});

test('capturing the cat silences its walking voice while the independent diving meow and primary clock continue', () => {
  const dsp = playing({ ghostGate: true }); dsp.syncPhase(0, 0, 0, .5, 0, 0, createWitchCatClock(31)); render(dsp, .1);
  const time = dsp.cat.time;
  dsp.setControls({ catCaptured: true }); assert.equal(dsp.trigger('meow'), false); assert.equal(dsp.trigger('drop-cat'), true);
  render(dsp, .15); assert.equal(dsp.cat.activeVoiceCount, 0); assert.ok(dsp.cat.time > time);
  assert.ok(dsp.visual.catMeow > .2); assert.ok(dsp.visual.dropLevel > .002);
  dsp.setControls({ ghostGate: false, gate: false }); render(dsp, .2); assert.equal(dsp.visual.catMeow, 0);
});

test('flight Fabric filters only its bounded wind puff and leaves the witch ensemble unchanged', () => {
  const dry = playing(), cloth = playing({ fabricX: .05, fabricY: .95 });
  assert.deepEqual(render(dry, .4), render(cloth, .4), 'stored cloth displacement does not filter the grounded brew');
  dry.setControls({ mode: 'flight' }); cloth.setControls({ mode: 'flight' }); render(dry, 1); render(cloth, 1);
  assert.deepEqual(render(dry, .2), render(cloth, .2), 'cloth displacement cannot color the witch or her flight echoes');
  cloth.setControls({ fabricX: .9, fabricY: .1, fabricPull: 1, fabricVelocity: 1 });
  assert.deepEqual(render(dry, .2), render(cloth, .2), 'live cloth motion is also isolated until wind is triggered');
  assert.equal(dry.chantPhase, cloth.chantPhase); assert.equal(dry.visual.handTime, cloth.visual.handTime);
  dry.setControls({ mode: 'brew' }); cloth.setControls({ mode: 'brew' }); render(dry, 1); render(cloth, 1);
  assert.ok(difference(render(dry, .2), render(cloth, .2)) < 1e-7, 'landing smoothly restores the dry brew');
  assert.equal(cloth.trigger('fabric-wind'), false, 'the grounded cloth cannot sound');
  const unarmed = new WitchDSP(8000); unarmed.setControls({ mode: 'flight' });
  assert.equal(unarmed.trigger('fabric-wind'), false);
  const puff = playing({ mode: 'flight', gate: false }, 8000), same = playing({ mode: 'flight', gate: false }, 8000);
  for (const dsp of [puff, same]) assert.equal(dsp.trigger('fabric-wind'), true);
  const sound = render(puff, .6);
  assert.deepEqual(sound, render(same, .6, 4800), 'wind uses the sample clock');
  assert.ok(rms(sound) > .003 && sound.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  assert.equal(puff.visual.delayLevel, 0, 'wind is not sent into Candy Coil or Sandy Syrup');
  render(puff, 4); assert.equal(puff.visual.fabricWindEnvelope, 0, 'an unattended puff ends without a queued event');
  assert.ok(rms(render(puff, .1)) < 1e-7, 'the separate resonators finish their tail');
  const voice = puff.fabricWind;
  for (const cancel of [dsp => dsp.setControls({ gate: false }), dsp => dsp.releaseAccents(),
    dsp => dsp.setControls({ mode: 'brew' }), dsp => dsp.setEnabled(false)]) {
    puff.setEnabled(true); puff.setControls({ mode: 'flight', gate: true, brewEnabled: false, handEnabled: false,
      backingEnabled: false, fabricX: .05, fabricY: .95, fabricPull: 1, fabricVelocity: 1 });
    for (let i = 0; i < 50; i++) puff.trigger('fabric-wind');
    render(puff, .1); assert.equal(puff.fabricWind, voice, 'drag refreshes reuse one voice');
    cancel(puff); render(puff, .4);
    assert.ok(puff.visual.fabricWindEnvelope < 1e-6, 'Stop, Reset, landing and mute release the puff');
    render(puff, 1.6); assert.ok(rms(render(puff, .1)) < 1e-7, 'the wind channel cannot leave ringing output after cancellation');
  }
});

test('anchored fabric pull and release velocity shape the wind without seeking or filtering performers', () => {
  for (const gesture of [{ fabricPull: .9 }, { fabricVelocity: 1 }]) {
    const controls = { mode: 'flight', fabricX: .56, fabricY: .45, trailPull: .08, trailSpace: .25 };
    const held = playing(controls, 8000), pulled = playing(controls, 8000);
    render(held, .4); render(pulled, .4);
    pulled.setControls(gesture);
    assert.deepEqual(render(held, .1), render(pulled, .1), 'pull and velocity do not filter the witch ensemble');
    held.trigger('fabric-wind'); pulled.trigger('fabric-wind');
    const a = render(held, .6), b = render(pulled, .6);
    assert.ok(difference(a, b) > .001, JSON.stringify(gesture));
    assert.equal(held.chantPhase, pulled.chantPhase); assert.equal(held.visual.handTime, pulled.visual.handTime);
    assert.equal(held.visual.flightPhase, pulled.visual.flightPhase);
    for (const [left, right] of held.delay.buffers.map((buffer, index) => [buffer, pulled.delay.buffers[index]])) {
      assert.deepEqual(left, right, 'neither the wind nor its filter can enter witch echo history');
    }
    assert.ok(b.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  }
});

test('noodle delay settings leave wind alone and a fresh puff cannot revive stopped witch echoes', () => {
  const wind = { mode: 'flight', gate: false, ghostGate: false, brewEnabled: false, handEnabled: false,
    backingEnabled: false, fabricX: .16, fabricY: .85, fabricPull: .8, fabricVelocity: .65 };
  const close = playing({ ...wind, trailPull: 0, trailTwist: 0, trailFeedback: 0, trailSpace: 0 }, 8000);
  const far = playing({ ...wind, trailPull: 1, trailTwist: 1, trailFeedback: 1, trailSpace: 1 }, 8000);
  close.trigger('fabric-wind'); far.trigger('fabric-wind');
  assert.deepEqual(render(close, 1.1), render(far, 1.1), 'wind bypasses every noodle delay control');
  assert.equal(close.visual.delayLevel, 0); assert.equal(far.visual.delayLevel, 0);

  const puff = playing({ mode: 'flight', trailPull: .04, trailSpace: .2 }, 8000);
  const reference = playing({ mode: 'flight', trailPull: .04, trailSpace: .2 }, 8000);
  for (const dsp of [puff, reference]) {
    render(dsp, 1);
    dsp.setControls({ gate: false, brewEnabled: false, handEnabled: false, backingEnabled: false }); render(dsp, .04);
  }
  assert.ok(puff.delay.stopping && puff.visual.delayLevel > 0, 'there is stopped echo history still fading');
  const flightPhase = puff.visual.flightPhase;
  for (const dsp of [puff, reference]) dsp.setControls({ gate: true, ghostGate: true });
  puff.trigger('fabric-wind');
  assert.equal(puff.delay.stopping, true, 'wind does not resume the separate delay');
  render(puff, .2); render(reference, .2);
  assert.equal(puff.delay.stopping, true, 'wind-only scene clocks do not reopen the delay');
  assert.ok(puff.visual.flightPhase > flightPhase, 'the broom still follows the global flight clock');
  assert.equal(puff.visual.delayLevel, reference.visual.delayLevel, 'old witch echoes retain the same release');
  assert.deepEqual(puff.delay.buffers, reference.delay.buffers);
  assert.ok(puff.visual.fabricWindEnvelope > .1, 'the new wind still sounds beside that release');
});

test('hair friction keeps a longer decaying texture after a pull while the singer retains its clock', () => {
  const dsp = playing({ hair: 1 }), held = playing({ hair: 1 }); render(dsp, .8); render(held, .8);
  dsp.setControls({ hair: 0 }); render(dsp, .3); render(held, .3);
  assert.ok(dsp.brew.hair < .001 && dsp.brew.hairTail > .5, 'anatomy settles while the loose strands keep rustling');
  const tail = render(dsp, .5), full = render(held, .5);
  assert.ok(difference(tail, full) > .02, 'the tail changes the rendered signal instead of remaining at full pull');
  assert.equal(dsp.chantPhase, held.chantPhase); assert.equal(dsp.visual.handTime, held.visual.handTime);
  assert.ok(dsp.brew.hairTail > .1 && dsp.brew.hairTail < .35);
  render(dsp, 7); assert.ok(dsp.brew.hairTail < 2e-6, 'the extra texture has a finite practical ending');
});
