import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchVisitorDSP } from '../src/instruments/witch/witch-visitors-audio.js';
import { WITCH_VISITORS } from '../src/instruments/witch/witch-visitors-model.js';
import { createQuadrupedState, quadrupedSequenceEvent, QUADRUPED_LANES } from '../src/instruments/quadruped/quadruped.js';

const RATE = 8000;
const visitorFor = (dsp, route) => dsp.visitors.find(visitor => visitor.id === route.id);
const voiceCount = visitor => visitor.voices.filter(voice => voice.samples !== null).length;
const contactsAt = (route, step) => quadrupedSequenceEvent(createQuadrupedState(route.id, route.behaviorId), step).contacts.length;
const atStep = (route, step, visit = 0) => route.first + visit * route.period + (step + .25) / route.stepsPerSecond;
function render(dsp, seconds, enabled = true, { hold = false, afterSample } = {}) {
  const start = dsp.time;
  let energy = 0, peak = 0;
  for (let sample = 1; sample <= Math.round(seconds * RATE); sample++) {
    dsp.next(hold ? start : start + sample / RATE, enabled);
    energy += dsp.left ** 2 + dsp.right ** 2;
    peak = Math.max(peak, Math.abs(dsp.left), Math.abs(dsp.right));
    afterSample?.();
  }
  assert.ok(Number.isFinite(energy) && Number.isFinite(peak), 'native foot playback remains finite');
  return { energy, peak };
}

test('mouse and lizard sound their native Quadruped contacts at the shared route clock', () => {
  for (const route of WITCH_VISITORS) {
    const dsp = new WitchVisitorDSP(RATE), visitor = visitorFor(dsp, route);
    dsp.syncTime(route.first - .06);
    assert.equal(render(dsp, .04).energy, 0, `${route.id} waits for its entrance`);
    assert.equal(visitor.triggerCount, 0);
    dsp.syncTime(route.first - 1 / RATE);
    const onsets = []; let previous = 0;
    const sound = render(dsp, 20 / route.stepsPerSecond, true, { afterSample() {
      if (visitor.triggerCount !== previous) {
        onsets.push({ step: Math.floor(visitor.position), count: visitor.triggerCount - previous });
        previous = visitor.triggerCount;
      }
    } });
    const expected = Array.from({ length: 20 }, (_, step) => ({ step, count: contactsAt(route, step) })).filter(event => event.count);
    assert.deepEqual(onsets, expected, `${route.id}: no missing, doubled, or renderer-timed contacts`);
    assert.ok(sound.energy > 0, `${route.id} has audible native feet`);
    assert.equal(visitor.lastStep, 19);
    dsp.next(route.first + route.duration, true);
    const ended = visitor.triggerCount;
    render(dsp, .06);
    assert.equal(voiceCount(visitor), 0);
    assert.equal(visitor.triggerCount, ended, 'the gaps between visits do not keep walking');
  }
});

test('stride and visit boundaries trigger exactly once, including a new visit at the same step number', () => {
  for (const route of WITCH_VISITORS) {
    const dsp = new WitchVisitorDSP(RATE), visitor = visitorFor(dsp, route);
    dsp.next(atStep(route, 15), true);
    const before = visitor.triggerCount;
    dsp.next(atStep(route, 16), true);
    assert.equal(visitor.lastStep, 16, 'the absolute stride step continues past the 16-step score loop');
    assert.equal(visitor.triggerCount, before + contactsAt(route, 16));
    dsp.next(atStep(route, 16) + 1 / RATE, true);
    assert.equal(visitor.triggerCount, before + contactsAt(route, 16), 'holding one step cannot repeat a contact');
    const firstVisit = visitor.triggerCount;
    dsp.next(atStep(route, 16, 1), true);
    assert.equal(visitor.lastVisit, 1); assert.equal(visitor.lastStep, 16);
    assert.equal(visitor.triggerCount, firstVisit + contactsAt(route, 16), 'a skipped period plays only its current contact');
    const secondVisit = visitor.triggerCount;
    dsp.next(atStep(route, 0, 2), true);
    assert.equal(visitor.lastVisit, 2); assert.equal(visitor.lastStep, 0);
    assert.equal(visitor.triggerCount, secondVisit + contactsAt(route, 0), 'a fresh entrance resets the route phase');
  }
});

test('capture fades the current visitor and only suppresses feet for that visit', () => {
  for (const route of WITCH_VISITORS) {
    const dsp = new WitchVisitorDSP(RATE), visitor = visitorFor(dsp, route);
    dsp.syncTime(route.first - 1 / RATE); render(dsp, .16);
    assert.ok(voiceCount(visitor) > 0);
    dsp.capture(route.id);
    assert.equal(visitor.capturedVisit, 0);
    const captured = visitor.triggerCount;
    render(dsp, .08);
    assert.equal(voiceCount(visitor), 0); assert.equal(visitor.triggerCount, captured);
    dsp.next(atStep(route, 40), true);
    assert.equal(visitor.triggerCount, captured, 'later feet cannot revive a captured animal');
    dsp.next(atStep(route, 0, 1), true);
    assert.equal(visitor.triggerCount, captured + contactsAt(route, 0));
    assert.ok(render(dsp, .04).energy > 0, 'the next visit can walk again');
    assert.equal(visitor.capturedVisit, 0, 'the old capture remains scoped to its original visit');
  }
});

test('mute and flight consume silent steps while a stopped clock releases without a resume burst', () => {
  for (const route of WITCH_VISITORS) {
    const dsp = new WitchVisitorDSP(RATE), visitor = visitorFor(dsp, route);
    dsp.syncTime(route.first - 1 / RATE); render(dsp, .12);
    const attacks = visitor.triggerCount, beforeMute = dsp.time;
    render(dsp, .2, false);
    assert.ok(dsp.time > beforeMute); assert.equal(visitor.triggerCount, attacks);
    assert.equal(voiceCount(visitor), 0);
    const stopped = dsp.time;
    assert.equal(render(dsp, .04, false, { hold: true }).energy, 0);
    assert.equal(dsp.time, stopped);
    // The same disabled path is used for an airborne visitor. Consume a real
    // touchdown, then enable inside that step: it must not attack retroactively.
    dsp.next(atStep(route, 24), false);
    dsp.next(atStep(route, 24) + 1 / RATE, true);
    assert.equal(visitor.lastStep, 24); assert.equal(visitor.triggerCount, attacks);
    dsp.next(atStep(route, 40), true);
    assert.equal(visitor.triggerCount, attacks + contactsAt(route, 40), 'skip past several contacts without replaying them');
    assert.ok(render(dsp, .04).energy > 0, 'fresh contacts still sound after landing or rearming');
  }
});

test('sync and reset release voices, clear captures and consume the current step before fresh feet', () => {
  for (const route of WITCH_VISITORS) {
    const dsp = new WitchVisitorDSP(RATE), visitor = visitorFor(dsp, route);
    dsp.syncTime(route.first - 1 / RATE); render(dsp, .16); dsp.capture(route.id);
    const attacks = visitor.triggerCount;
    dsp.syncTime(0); render(dsp, .04, false, { hold: true });
    assert.equal(dsp.time, 0); assert.equal(visitor.capturedVisit, -1);
    assert.equal(visitor.position, 0); assert.equal(voiceCount(visitor), 0);
    assert.equal(visitor.triggerCount, attacks);
    dsp.syncTime(atStep(route, 8));
    assert.equal(visitor.lastStep, 8);
    dsp.next(atStep(route, 8) + 1 / RATE, true);
    assert.equal(visitor.triggerCount, attacks, 'audio handoff never repeats the current touchdown');
    dsp.next(atStep(route, 12), true);
    assert.equal(visitor.triggerCount, attacks + contactsAt(route, 12));
    assert.ok(render(dsp, .04).energy > 0);
    dsp.release(); render(dsp, .04, false, { hold: true });
    assert.equal(voiceCount(visitor), 0);
  }
});

test('many visits retain fixed native sample banks and voice pools without onset-time synthesis', () => {
  const dsp = new WitchVisitorDSP(RATE);
  const storage = dsp.visitors.map(visitor => ({ visitor, events: visitor.events, voices: visitor.voices,
    voiceObjects: visitor.voices.slice(), samples: visitor.samples, buffers: visitor.samples.map(sample => sample.samples) }));
  for (const { visitor } of storage) {
    assert.equal(visitor.bank.size, QUADRUPED_LANES.length * 2);
    assert.equal(visitor.voices.length, 12);
    visitor.bank.get = () => { throw new Error('sample preparation during playback is forbidden'); };
  }
  let peak = 0;
  for (let visit = 0; visit < 8; visit++) for (const route of WITCH_VISITORS) {
    dsp.syncTime(route.first + visit * route.period - 1 / RATE);
    peak = Math.max(peak, render(dsp, .2).peak);
    for (const fixed of storage) {
      assert.equal(fixed.visitor.events, fixed.events); assert.equal(fixed.visitor.voices, fixed.voices);
      assert.equal(fixed.visitor.samples, fixed.samples); assert.ok(voiceCount(fixed.visitor) <= 12);
      assert.ok(fixed.visitor.voices.every((voice, i) => voice === fixed.voiceObjects[i]));
      assert.ok(fixed.visitor.samples.every((sample, i) => sample.samples === fixed.buffers[i]));
      assert.equal(fixed.visitor.bank.size, QUADRUPED_LANES.length * 2);
    }
  }
  assert.ok(peak > 0 && peak < 2, 'native sample playback stays finite with headroom for the shared mixer');
  dsp.release(); render(dsp, .04, false, { hold: true });
  assert.ok(dsp.visitors.every(visitor => voiceCount(visitor) === 0));
});

test('an Audio rebuild restores captured visits without replaying feet or suppressing the next visit', () => {
  for (const route of WITCH_VISITORS) {
    const rebuilt = new WitchVisitorDSP(RATE), visitor = visitorFor(rebuilt, route);
    rebuilt.syncTime(route.first + .4, { [route.id]: route.first + .2 });
    assert.equal(render(rebuilt, .2).energy, 0);
    assert.equal(visitor.triggerCount, 0, 'the invisible captured animal stays silent');
    rebuilt.syncTime(route.first + route.period - 1 / RATE, { [route.id]: route.first + .2 });
    assert.ok(render(rebuilt, .2).energy > 0, 'a saved capture cannot hide a later visit');
    for (const invalid of [NaN, -1, route.first + route.duration + .1, route.first + 1]) {
      rebuilt.syncTime(route.first + .4, { [route.id]: invalid });
      assert.equal(visitor.capturedVisit, -1, 'invalid, absent or future captures are ignored');
    }
  }
});
