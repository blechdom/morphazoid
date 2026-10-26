import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { WitchAudio } from '../src/instruments/witch/witch-audio.js';
import { WITCH_INGREDIENTS } from '../src/instruments/witch/witch-model.js';
import { witchBiteClips, witchBiteVariants, WitchBlechFlyby } from '../src/instruments/witch/witch-scene-audio.js';

const RATE = 12000;
const kinds = [...new Set(WITCH_INGREDIENTS.map(ingredient => ingredient.kind))];
const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value ** 2, 0) / data.length);
const difference = (a, b) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
function armed() {
  const dsp = new WitchDSP(RATE);
  dsp.setControls({ gate: false, ghostGate: false, mode: 'brew' }); dsp.setEnabled(true);
  return dsp;
}
function render(dsp, seconds = .75) {
  const data = new Float32Array(Math.round(seconds * RATE));
  for (let offset = 0; offset < data.length; offset += 128) dsp.process(data.subarray(offset, Math.min(offset + 128, data.length)));
  return data;
}

for (const kind of kinds) test(`${kind} has three audible, finite and distinct native tastes`, t => {
  // Fresh engines prevent a preceding phrase, random stream or delay history
  // from creating false separation between otherwise identical variants.
  const bank = witchBiteVariants()[kind] ?? [];
  const seconds = Math.max(['drop-blech', 'drop-eyeball', 'drop-syrinx'].includes(kind) ? 5 : 2.4,
    ...bank.map(clip => clip.frames / clip.rate));
  const sounds = [0, 1, 2].map(variant => {
    const dsp = armed();
    assert.equal(dsp.trigger(kind, variant), true);
    const data = render(dsp, seconds), level = rms(data);
    assert.equal(dsp.visual.dropVariant, variant);
    assert.ok(level > .004, `${kind}/${variant}: usable ingredient level`);
    assert.ok(data.every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
    return { data, level };
  });
  const levels = sounds.map(sound => sound.level);
  const spreadDb = 20 * Math.log10(Math.max(...levels) / Math.min(...levels));
  t.diagnostic(`${kind}: full-phrase RMS ${levels.map(level => level.toFixed(5)).join(', ')}, spread ${spreadDb.toFixed(2)} dB${spreadDb > 3 ? ' — review source trims' : ''}`);
  assert.ok(spreadDb <= 5, `${kind}: alternate tastes stay within 5 dB of one another (${spreadDb.toFixed(2)} dB)`);
  for (let i = 0; i < sounds.length; i++) for (let j = 0; j < i; j++) {
    assert.ok(difference(sounds[i].data, sounds[j].data) > Math.max(.002, Math.min(sounds[i].level, sounds[j].level) * .08),
      `${kind}: tastes ${j} and ${i} change the actual rendered phrase`);
  }
});

test('accepted drops cycle independently through 0, 1, 2, 0 and muted gestures consume no taste', () => {
  const dsp = armed(), slots = dsp.drops.slots;
  for (const kind of kinds) {
    const slot = slots.find(item => item.kind === kind);
    const untouched = slots.filter(item => item !== slot).map(item => item.nextVariant);
    for (const expected of [0, 1, 2, 0]) {
      assert.equal(dsp.trigger(kind), true); assert.equal(slot.variant, expected);
      assert.equal(slot.nextVariant, (expected + 1) % 3);
    }
    assert.deepEqual(slots.filter(item => item !== slot).map(item => item.nextVariant), untouched);
  }
  const counters = slots.map(slot => slot.nextVariant);
  dsp.setEnabled(false);
  for (const kind of kinds) assert.equal(dsp.trigger(kind), false);
  assert.deepEqual(slots.map(slot => slot.nextVariant), counters);
  dsp.setEnabled(true); dsp.setControls({ mode: 'flight', handSound: 'iron-claws' });
  dsp.releaseAccents(); dsp.trigger('dice-charm'); dsp.trigger('mushroom-gloop');
  assert.deepEqual(slots.map(slot => slot.nextVariant), counters, 'scene changes and picture accents preserve ingredient cycles');
  for (const kind of kinds) {
    assert.equal(dsp.trigger(kind), true);
    assert.equal(slots.find(slot => slot.kind === kind).variant, 1, 'the next accepted drop resumes its own cycle');
  }
  assert.equal(dsp.drops.slots, slots, 'cycling reuses the fixed ingredient slots');
});

test('variant readers share decoded banks, original clips and Quadruped aliases across engines', () => {
  const base = witchBiteClips(), variants = witchBiteVariants(), a = armed(), b = armed();
  assert.equal(witchBiteClips(), base); assert.equal(witchBiteVariants(), variants);
  assert.equal(a.drops.tastes.clips, base); assert.equal(b.drops.tastes.clips, base);
  assert.equal(a.drops.tastes.variants, variants); assert.equal(b.drops.tastes.variants, variants);
  assert.equal(variants['drop-cat'], variants['drop-quadruped']);
  assert.equal(base['drop-cat'], base['drop-quadruped']);
  const unique = new Set(Object.values(base));
  for (const [kind, bank] of Object.entries(variants)) {
    assert.equal(bank.length, 3); assert.ok(Object.isFrozen(bank));
    assert.equal(bank[0], base[kind], `${kind}: the initial taste does not decode twice`);
    for (const clip of bank) {
      unique.add(clip);
      assert.equal(clip.data.length, clip.frames); assert.equal(clip.rate, 22050);
      assert.equal(a.trigger(kind, bank.indexOf(clip)), true);
      assert.equal(a.drops.slots.find(slot => slot.kind === kind).clip, clip, 'the live reader adopts the shared PCM');
    }
  }
  const bytes = [...unique].reduce((sum, clip) => sum + clip.data.byteLength, 0);
  assert.ok(bytes <= 12_000_000, 'the complete shared PCM bank stays bounded rather than growing per drop or engine');
});

// Minimal graph/port substitutes keep the real WitchAudio start/detach/rebuild
// boundary in this test; the mock never synthesizes or chooses a variant.
function audioRuntime() {
  const messages = [], nodes = [];
  class Node {
    connect() {} disconnect() {}
  }
  class Context {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new Node(); this.audioWorklet = { async addModule() {} }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createGain() {
      const node = new Node(); node.gain = { value: 0, cancelAndHoldAtTime() {}, setTargetAtTime() {} }; return node;
    }
  }
  class Worklet extends Node {
    constructor() { super(); nodes.push(this); this.port = { postMessage: message => messages.push(message), close() {} }; }
  }
  return { runtime: { AudioContext: Context, AudioWorkletNode: Worklet }, messages, nodes };
}

test('the Audio owner retains accepted taste cycles across preset edits, mute and worklet rebuild', async () => {
  const { runtime, messages, nodes } = audioRuntime(), audio = new WitchAudio(runtime);
  const sent = kind => messages.filter(message => message.type === 'trigger' && message.kind === kind).map(message => message.variant);
  try {
    assert.equal(audio.trigger('drop-puggler'), false);
    await audio.start(); audio.setAudible(true);
    assert.equal(audio.trigger('drop-puggler'), true); assert.equal(audio.trigger('drop-spider'), true);
    audio.update({ mode: 'flight', voice: 'sing', handSound: 'iron-claws' });
    assert.equal(audio.trigger('drop-puggler'), true);
    audio.setAudible(false); assert.equal(audio.trigger('drop-puggler'), false);
    audio.detach(); assert.equal(audio.trigger('drop-puggler'), false);
    await audio.start(); assert.equal(nodes.length, 2);
    assert.equal(audio.trigger('drop-puggler'), false, 'a rebuild still waits for Audio arming');
    audio.setAudible(true);
    assert.equal(audio.trigger('drop-puggler'), true); assert.equal(audio.trigger('drop-puggler'), true);
    assert.equal(audio.trigger('drop-spider'), true);
    assert.deepEqual(sent('drop-puggler'), [0, 1, 2, 0]); assert.deepEqual(sent('drop-spider'), [0, 1]);
    audio.context.state = 'suspended'; assert.equal(audio.trigger('drop-spider'), false);
    audio.context.state = 'running'; assert.equal(audio.trigger('drop-spider'), true);
    assert.deepEqual(sent('drop-spider'), [0, 1, 2], 'a suspended context consumes no taste');
    assert.equal(audio.trigger('not-an-effect'), false);
    assert.equal(audio.trigger('mushroom-gloop'), true);
    assert.deepEqual(Object.keys(audio.nextDropVariants).sort(), ['drop-puggler', 'drop-spider']);
  } finally { await audio.dispose(); }
});

test('BLECH flybys cycle only audible entrances and overlapping passes retain their own clips', () => {
  const flyby = new WitchBlechFlyby(RATE), pool = flyby.slots.slice(), bank = witchBiteVariants()['drop-blech'];
  const controls = { ghostGate: true, mode: 'flight' };
  const until = (target, enabled = true) => {
    let energy = 0;
    for (let i = 0, count = Math.ceil((target - flyby.time) * RATE); i < count; i++) {
      flyby.next(controls, enabled);
      assert.ok(Number.isFinite(flyby.left) && Number.isFinite(flyby.right));
      energy += flyby.left ** 2 + flyby.right ** 2;
    }
    return energy;
  };
  flyby.syncTime(4.99); assert.ok(until(5.35) > 0);
  assert.equal(flyby.slots[0].variant, 0); assert.equal(flyby.slots[0].clip, bank[0]);
  flyby.syncTime(15.99); assert.ok(until(16.3) > 0);
  const continuing = flyby.slots[0].clip;
  assert.equal(continuing, bank[1]);
  assert.ok(until(18.5) > 0);
  assert.ok(flyby.slots.every(slot => slot.age >= 0), 'the two native phrases overlap');
  assert.equal(flyby.slots[0].clip, continuing, 'the new visitor cannot replace an already sounding reader');
  assert.equal(flyby.slots[1].variant, 2); assert.equal(flyby.slots[1].clip, bank[2]);
  assert.equal(flyby.nextVariant, 0);
  flyby.syncTime(30.99); until(31.3);
  assert.equal(flyby.slots[0].variant, 0); assert.equal(flyby.nextVariant, 1);
  flyby.syncTime(41.99); until(42.08, false);
  assert.equal(flyby.nextVariant, 1, 'the muted entrance does not consume its next native demo');
  assert.ok(flyby.slots.every(slot => slot.age < 0));
  assert.equal(until(42.3), 0, 'rearming cannot replay the skipped entrance');
  assert.ok(until(44.5) > 0); assert.equal(flyby.slots[1].variant, 1);
  assert.equal(flyby.slots[1].clip, bank[1]); assert.equal(flyby.nextVariant, 2);
  assert.ok(flyby.slots.every((slot, i) => slot === pool[i]));
});
