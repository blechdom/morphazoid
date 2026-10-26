import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { witchBiteClips, WITCH_WEB_RATIOS, WitchEyeShock, WitchSceneDSP, WitchBlechFlyby } from '../src/instruments/witch/witch-scene-audio.js';
import { WITCH_BITE_CLIPS } from '../src/instruments/witch/witch-bite-clips.js';
import { createWitchCatClock } from '../src/instruments/witch/witch-cat-model.js';
import { getWitchBlechFlyby, WITCH_BLECH_FLYBY_CYCLE } from '../src/instruments/witch/witch-scene-model.js';

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
  assert.deepEqual(Object.keys(clips), Object.keys(WITCH_BITE_CLIPS));
  let bytes = 0;
  const signals = [];
  for (const [kind, clip] of Object.entries(clips)) {
    bytes += clip.data.byteLength;
    assert.equal(clip.frames, clip.data.length); assert.equal(clip.rate, 22050);
    assert.ok(clip.data.every(value => Number.isFinite(value) && Math.abs(value) <= .65001));
    assert.equal(clip.data[0], 0); assert.equal(clip.data.at(-1), 0);
    assert.ok(rms(clip.data) > .04, `${kind}: authored dynamics retain usable source level`);
    const dsp = playing({ gate: false }); assert.equal(dsp.trigger(kind === 'roach-wings' ? 'drop-roach' : kind), true);
    const signal = render(dsp, .8); assert.ok(rms(signal) > .006, kind); signals.push(signal);
  }
  assert.ok(bytes < 3_000_000, 'finite mono excerpts stay within three MB decoded');
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

test('Rubix and FM Drums race through reusable hit pools and Rattlesnake has a falling cascade', () => {
  const dsp = playing({ gate: false }); dsp.trigger('drop-rubix'); render(dsp, 2.4);
  assert.equal(dsp.drops.slots.find(s => s.kind === 'drop-rubix').event, 32);
  dsp.trigger('drop-oculoid'); render(dsp, 2.4);
  assert.equal(dsp.drops.slots.find(s => s.kind === 'drop-oculoid').event, 27);
  const snake = witchBiteClips()['drop-marimba'];
  assert.equal(snake.instrumentId, 'linear-drums'); assert.equal(snake.events, 36);
  assert.ok(rms(snake.data.subarray(snake.rate, snake.rate * 1.9)) > .04, 'the cascade continues through the fall');
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
