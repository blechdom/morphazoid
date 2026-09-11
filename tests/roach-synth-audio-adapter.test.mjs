import assert from 'node:assert/strict';
import test from 'node:test';
import { RoachSynthAudio, createDefaultRoachBodyMix } from '../src/roach-synth-audio.js';
import { RoachSynthDsp } from '../src/roach-synth-dsp.js';

function fixture() {
  const contexts = []; const messages = []; const rate = 24000;
  class Node {
    constructor() { this.gain = { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } }; }
    connect() {} disconnect() {}
  }
  class Context {
    constructor() { this.currentTime = 0; this.state = 'suspended'; this.destination = new Node(); this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createGain() { return new Node(); }
  }
  class Worklet extends Node {
    constructor() {
      super(); this.dsp = new RoachSynthDsp(rate);
      this.port = { close() {}, postMessage: (message) => {
        messages.push(structuredClone(message));
        if (message.type === 'state') this.dsp.update(message.state);
        if (message.type === 'interact') this.dsp.interact(message.interaction);
      } };
    }
  }
  return { contexts, messages, runtime: { AudioContext: Context, AudioWorkletNode: Worklet,
    performance: { now: () => 0 }, fetch: async () => ({ ok: false }) } };
}
function energy(dsp, seconds) {
  const left = new Float32Array(Math.round(dsp.sampleRate * seconds)); const right = new Float32Array(left.length);
  dsp.render(left, right);
  return Math.sqrt(left.reduce((sum, value) => sum + value * value, 0) / left.length);
}

test('body mixer updates normalize and own rows without changing Audio or either transport clock', async () => {
  const f = fixture(); const audio = new RoachSynthAudio({ runtime: f.runtime });
  const bodyMix = createDefaultRoachBodyMix(); bodyMix[0] = { groupId: 'legs', source: 'zing', level: 88 };
  audio.update({ bodyMix, playing: true, soundPlaying: true, time: 7 });
  assert.equal(f.contexts.length, 0, 'body assignments must not implicitly create Audio');
  bodyMix[0].source = 'imaginary'; bodyMix[0].level = 0;
  assert.deepEqual(audio.state.bodyMix[0], { groupId: 'legs', source: 'zing', level: 1 });
  try {
    await audio.enable(); const context = f.contexts[0]; context.currentTime = 3;
    const before = audio.getTime(); const anchor = audio.anchorClock;
    audio.update({ bodyMix: [{ groupId: 'legs', source: 'skuttle', level: 0 }] });
    assert.equal(audio.getTime(), before); assert.equal(audio.anchorClock, anchor);
    assert.equal(audio.getState().playing, true); assert.equal(audio.getState().soundPlaying, true);
    assert.equal(audio.enabled, true); assert.equal(f.contexts.length, 1);
    assert.deepEqual(Object.keys(f.messages.at(-1).state), ['bodyMix'], 'a mixer gesture must not retransmit geometry or reset its motion clock');
    assert.equal(f.messages.at(-1).state.bodyMix.length, 8);
    assert.equal(audio.node.dsp.bodyMix[0].level, 0);
  } finally { audio.dispose(); }
});

test('resetActivity is an edge: a static teleport stays silent and the next real drag still sounds', async () => {
  const f = fixture(); const audio = new RoachSynthAudio({ runtime: f.runtime });
  const joints = [{ id: 'head', jointId: 'head', name: 'Head', offset: { x: 0, y: 0, z: 0 } }];
  const bodyMix = createDefaultRoachBodyMix().map((row) => ({ ...row, source: 'walls', level: row.groupId === 'head' ? 1 : 0 }));
  try {
    await audio.enable({ joints, bodyMix, playing: false, soundPlaying: true, motion: { presetId: 'none', antennae: false }, resetActivity: true });
    const dsp = audio.node.dsp; assert.equal(energy(dsp, .1), 0);
    audio.update({ joints: [{ ...joints[0], offset: { x: 55, y: 20, z: -30 } }], resetActivity: true });
    assert.equal(f.messages.at(-1).state.resetActivity, true);
    assert.equal('resetActivity' in audio.state, false);
    assert.equal(energy(dsp, .3), 0, 'a preset load must not be mistaken for friction');
    audio.update({ sound: { brightness: .7 } });
    assert.equal('resetActivity' in f.messages.at(-1).state, false);
    audio.update({ joints: [{ ...joints[0], offset: { x: 62, y: 21, z: -28 } }] });
    assert.equal('resetActivity' in f.messages.at(-1).state, false);
    assert.ok(energy(dsp, .08) > .004, 'a non-sticky reset allows the subsequent physical drag to excite its own sound');
    audio.disable(); await audio.enable();
    assert.equal('resetActivity' in f.messages.at(-1).state, false, 'rearming must not replay an old reset edge');
  } finally { audio.dispose(); }
});
