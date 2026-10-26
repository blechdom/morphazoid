import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { witchBiteClips, WITCH_WEB_RATIOS, WitchEyeShock, WitchSceneDSP, WitchBlechFlyby, WitchTreePhrase } from '../src/instruments/witch/witch-scene-audio.js';
import { WITCH_BITE_CLIPS } from '../src/instruments/witch/witch-bite-clips.js';
import { normalizeWitchControls } from '../src/instruments/witch/witch-model.js';
import { createWitchCatClock } from '../src/instruments/witch/witch-cat-model.js';
import { getWitchBlechFlyby, WITCH_BLECH_FLYBY_CYCLE } from '../src/instruments/witch/witch-scene-model.js';
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

test('BLECH flybys share a sparse icon and native-phrase clock with two bounded voices', () => {
  assert.deepEqual(getWitchBlechFlyby(4.99), []);
  assert.equal(getWitchBlechFlyby(5.3).length, 1);
  assert.equal(getWitchBlechFlyby(18.5).length, 2);
  assert.deepEqual(getWitchBlechFlyby(Infinity), []);
  const first = getWitchBlechFlyby(5.3)[0], repeated = getWitchBlechFlyby(WITCH_BLECH_FLYBY_CYCLE + 5.3)[0];
  assert.ok(Math.abs(first.x - repeated.x) < 1e-9); assert.notEqual(first.id, repeated.id);
  const flyby = new WitchBlechFlyby(8000), pool = flyby.slots.slice(), controls = { mode: 'flight', ghostGate: true };
  assert.equal(flyby.clip, witchBiteClips()['drop-blech'], 'the actual BLECH phrase is shared, not synthesized again');
  const midi = readFileSync(new URL('../assets/midiphoria/midi/black-lattice.mid', import.meta.url));
  const score = parseBlackMidiScore(midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength));
  let attacks = 0;
  for (let i = 0; i < score.total; i++) if (score.ends[i] > 32 && score.starts[i] < 36.5) attacks++;
  assert.equal(flyby.clip.events, attacks, 'every event in the actual BLACK MIDI excerpt is retained');
  assert.ok(attacks > 1000); assert.match(WITCH_BITE_CLIPS['drop-blech'].source, /black-lattice\.mid.*native SpessaSynth/);
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
  assert.ok(bytes < 4_000_000, 'three new 2.4-second native excerpts fit a four MB decoded budget; the cat alias adds no bytes');
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

test('tree click plays the native L-System phrase through the scene mix with bounded retriggers and release', () => {
  const clip = witchBiteClips()['tree-l-system'];
  assert.equal(clip.instrumentId, 'l-systems'); assert.equal(clip.events, 15);
  assert.match(WITCH_BITE_CLIPS['tree-l-system'].source, /native coral traversal.*MorphazoidContourSynth FM/);
  const off = new WitchDSP(8000); assert.equal(off.trigger('tree-l-system'), false);
  const a = playing({ gate: false }, 8000), b = playing({ gate: false }, 8000);
  for (const dsp of [a, b]) assert.equal(dsp.trigger('tree-l-system'), true);
  const sound = render(a, .8); assert.deepEqual(sound, render(b, .8, 6400));
  assert.ok(rms(sound) > .02); assert.ok(a.visual.treeEnvelope > .9); assert.ok(a.visual.treeLevel > .005);
  assert.ok(a.visual.treeProgress>0&&a.visual.treeProgress<1, 'branch light follows an active audio playhead');
  assert.equal(a.drops.solo, 0); assert.equal(a.visual.dropKind, ''); assert.equal(a.visual.dropLevel, 0);
  render(a, 2); assert.equal(a.visual.treeEnvelope, 0); assert.ok(rms(render(a, .1)) < 1e-7);
  const tree = a.scene.tree, controls = JSON.stringify(a.controls);
  for (let i = 0; i < 80; i++) { a.trigger('tree-l-system'); render(a, .004); }
  assert.equal(a.scene.tree, tree); assert.equal(JSON.stringify(a.controls), controls);
  assert.ok(render(a, .2).every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  for (const cancel of [dsp => dsp.releaseAccents(), dsp => dsp.setControls({ gate: false, ghostGate: false }), dsp => dsp.setEnabled(false)]) {
    a.setEnabled(true); a.setControls({ gate: true, ghostGate: true }); a.trigger('tree-l-system'); render(a, .3);
    cancel(a); render(a, .1); render(a, .05); assert.equal(a.visual.treeLevel, 0); assert.equal(a.visual.treeEnvelope, 0);
  }
  assert.equal(a.trigger('tree-l-system'), false); a.setEnabled(true); render(a, .2); assert.equal(a.visual.treeLevel, 0);
  const plain = playing({ mode: 'flight' }, 8000), filtered = playing({ mode: 'flight', fabricX: .04, fabricY: .94 }, 8000);
  plain.trigger('tree-l-system'); filtered.trigger('tree-l-system');
  assert.ok(difference(render(plain, .7), render(filtered, .7)) > .01);
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

test('live branch edits bend a continuing sample cursor without seeking, restarting or losing a finite release', () => {
  const held = new WitchTreePhrase(8000), bent = new WitchTreePhrase(8000);
  held.trigger(); bent.trigger();
  for (let i = 0; i < 1200; i++) { held.next(true); bent.next(true); assert.equal(held.left, bent.left); }
  const cursor = bent.cursor, age = bent.age, clip = bent.clip;
  bent.setControls(1, 1);
  assert.equal(bent.cursor, cursor); assert.equal(bent.age, age); assert.equal(bent.restart, false);
  let differenceEnergy = 0, largestRateStep = 0;
  for (let i = 0; i < 4000; i++) {
    const before = bent.cursor, previousRate = bent.playbackRate;
    held.next(true); bent.next(true);
    differenceEnergy += (held.left - bent.left) ** 2 + (held.right - bent.right) ** 2;
    assert.ok(bent.cursor > before && bent.cursor - before <= bent.dt * 1.4 + 1e-12, 'the source position only advances by its bounded rate');
    largestRateStep = Math.max(largestRateStep, Math.abs(bent.playbackRate - previousRate));
  }
  assert.ok(differenceEnergy > .01, 'branch motion changes the rendered phrase');
  assert.ok(largestRateStep < .002 && bent.playbackRate > 1.399, 'the pitch reaches its target through a short slew');
  assert.equal(bent.age, held.age, 'the elapsed gesture clock does not seek with pitch');
  assert.equal(bent.clip, clip); assert.equal(bent.restart, false);
  bent.release(); for (let i = 0; i < 400; i++) bent.next(true);
  assert.equal(bent.left, 0); assert.equal(bent.right, 0); assert.equal(bent.age, -1);
  bent.setControls(0, 0); bent.trigger();
  for (let i = 0; i < 32000; i++) {
    bent.next(true);
    assert.ok(Number.isFinite(bent.left) && Number.isFinite(bent.right));
    assert.ok(bent.playbackRate >= .7 && bent.playbackRate <= 1.4);
  }
  assert.equal(bent.age, -1, 'even the slowest phrase ends without another trigger');
  assert.equal(bent.left, 0); assert.equal(bent.right, 0);
});

test('branch spread and curl reach the scene sound as audible pitch and modest stereo motion', () => {
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
    assert.equal(variant.dsp.drops.solo, 0, 'branch motion uses the existing scene reader');
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

test('flight Fabric filters the ensemble and adds a bounded wind puff while the ground stays dry', () => {
  const dry = playing(), cloth = playing({ fabricX: .05, fabricY: .95 });
  assert.deepEqual(render(dry, .4), render(cloth, .4), 'stored cloth displacement does not filter the grounded brew');
  dry.setControls({ mode: 'flight' }); cloth.setControls({ mode: 'flight' }); render(dry, 1); render(cloth, 1);
  assert.ok(difference(render(dry, .2), render(cloth, .2)) > .01, 'the cloth processes the shared flight mix');
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
  render(puff, 4); assert.equal(puff.visual.fabricWindEnvelope, 0, 'an unattended puff ends without a queued event');
  const voice = puff.fabricWind;
  for (const cancel of [dsp => dsp.setControls({ gate: false }), dsp => dsp.releaseAccents(),
    dsp => dsp.setControls({ mode: 'brew' }), dsp => dsp.setEnabled(false)]) {
    puff.setEnabled(true); puff.setControls({ mode: 'flight', gate: true });
    for (let i = 0; i < 50; i++) puff.trigger('fabric-wind');
    render(puff, .1); assert.equal(puff.fabricWind, voice, 'drag refreshes reuse one voice');
    cancel(puff); render(puff, .4);
    assert.ok(puff.visual.fabricWindEnvelope < 1e-6, 'Stop, Reset, landing and mute release the puff');
  }
});

test('anchored fabric pull and release velocity each change the shared flight spectrum without seeking performers', () => {
  for (const gesture of [{ fabricPull: .9 }, { fabricVelocity: 1 }]) {
    const controls = { mode: 'flight', fabricX: .56, fabricY: .45, trailPull: .08, trailSpace: .25 };
    const held = playing(controls, 8000), pulled = playing(controls, 8000);
    render(held, .4); render(pulled, .4);
    pulled.setControls(gesture);
    const a = render(held, .6), b = render(pulled, .6);
    assert.ok(difference(a, b) > .005, JSON.stringify(gesture));
    assert.equal(held.chantPhase, pulled.chantPhase); assert.equal(held.visual.handTime, pulled.visual.handTime);
    assert.equal(held.visual.flightPhase, pulled.visual.flightPhase);
    assert.ok(b.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
  }
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
