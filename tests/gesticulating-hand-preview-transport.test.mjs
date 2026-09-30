import assert from 'node:assert/strict';
import test from 'node:test';
import {HandAudio} from '../src/instruments/gesticulating-hand/hand-audio.js';

// Test the wrapper boundary without granting it a graph to create or resume.
test('preset preview only posts while Audio is already armed and running', () => {
  let contexts = 0, resumes = 0;
  const audio = new HandAudio({performance: {now: () => 1000}, AudioContext: class {constructor() {contexts++;}}});
  assert.equal(audio.previewPreset(), false); assert.equal(contexts, 0);
  const sent = [];
  audio.node = {port: {postMessage: message => sent.push(message)}};
  audio.context = {state: 'suspended', currentTime: 7.25, resume: () => resumes++};
  audio.armed = true;
  assert.equal(audio.previewPreset(), false);
  audio.context.state = 'running'; audio.armed = false;
  assert.equal(audio.previewPreset(), false);
  assert.deepEqual(sent, []); assert.equal(resumes, 0);
  audio.armed = true; audio.playing = true; audio.soundPlaying = false;
  audio.heldFingers = 6; audio.level = .31; audio.anchorTime = 4; audio.anchorClock = 7;
  audio.tremorOffset = .125; audio.rhythmOffset = -.25;
  const before = {...audio.getState(), level: audio.level, config: structuredClone(audio.config)};
  assert.equal(audio.previewPreset(), true);
  assert.equal(audio.previewPreset(10), true);
  assert.equal(audio.previewPreset(-1), true);
  assert.deepEqual(sent, [
    {type: 'preview', seconds: .75, audioTime: 7.25},
    {type: 'preview', seconds: 1.5, audioTime: 7.25},
    {type: 'preview', seconds: .015, audioTime: 7.25},
  ]);
  assert.deepEqual({...audio.getState(), level: audio.level, config: audio.config}, before);
  assert.equal(contexts, 0); assert.equal(resumes, 0);
  audio.mute(); const messages = sent.length;
  assert.equal(audio.previewPreset(), false); assert.equal(sent.length, messages);
  audio.context.state = 'closed'; audio.armed = true;
  assert.equal(audio.previewPreset(), false); assert.equal(sent.length, messages);
});

test('worklet discards expired previews and forwards bounded audio-clock timestamps', async () => {
  const names = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime'];
  const saved = names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  let Processor;
  try {
    globalThis.AudioWorkletProcessor = class {constructor() {this.port = {postMessage() {}};}};
    globalThis.registerProcessor = (name, Type) => {assert.equal(name, 'gesticulating-hand'); Processor = Type;};
    globalThis.sampleRate = 24000; globalThis.currentTime = 10;
    await import('../src/instruments/gesticulating-hand/hand-processor.js');
    const processor = new Processor(), previews = [], auditions = [];
    processor.dsp.previewPreset = (...args) => previews.push(args);
    processor.dsp.auditionFinger = (...args) => auditions.push(args);
    const send = data => processor.port.onmessage({data});
    send({type: 'preview', audioTime: 8, seconds: 1.5});
    send({type: 'preview', audioTime: 9.25, seconds: .75});
    assert.deepEqual(previews, [], 'expired UI feedback must not replay after a stalled thread');
    send({type: 'preview', audioTime: 9.7, seconds: .75});
    send({type: 'preview', audioTime: 12, seconds: 10});
    send({type: 'preview'});
    assert.deepEqual(previews, [[.75, 9.7], [1.5, 10], [.75, 10]]);
    send({type: 'audition', index: 2, seconds: .18, audioTime: 9.9});
    assert.deepEqual(auditions, [[2, .18, 9.9]], 'direct finger audition keeps its existing message contract');
    send({type: 'dispose'}); send({type: 'preview', audioTime: 10, seconds: .75});
    assert.equal(previews.length, 3, 'teardown rejects new previews');
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
