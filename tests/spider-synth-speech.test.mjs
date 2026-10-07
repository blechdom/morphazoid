import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNativeText, nativeTextDefaults } from '../src/families/speech/native-text.js';
import { SpiderSynthAudio } from '../src/instruments/spider-synth/spider-synth-audio.js';
import { SpiderSpeechPlayer } from '../src/instruments/spider-synth/spider-synth-speech-player.js';
import { SPIDER_SPEECH_PRESETS, spiderSpeechRequest } from '../src/instruments/spider-synth/spider-synth-speech.js';

test('real native British variants pronounce parked without the American rhotic vowel', async () => {
  assert.equal(nativeTextDefaults('espeak').language, 'en-us');
  for (const preset of SPIDER_SPEECH_PRESETS) {
    const request = spiderSpeechRequest('I parked the car in the garage.', { ...preset, preset: preset.id });
    const gb = await renderNativeText(request.engine, request.text, request.values);
    const us = await renderNativeText(request.engine, request.text, { ...request.values, language: 'en-us' });
    const phones = result => result.events.filter(e => e.type === 'phoneme').map(e => e.phone);
    assert.ok(phones(us).some(phone => phone.includes('ɑːɹ')), preset.id);
    assert.ok(!phones(gb).some(phone => phone.includes('ɑːɹ')), preset.id);
    assert.notDeepEqual(phones(gb), phones(us));
    assert.ok(gb.samples.some(x => Math.abs(x) > .02), preset.id);
    assert.ok(gb.samples.every(Number.isFinite));
  }
});

test('PCM replacement retains the old buffer through fade, newest request wins and stop drops pending speech', () => {
  const p = new SpiderSpeechPlayer(24000), a = new Float32Array(24000).fill(.5), b = new Float32Array(24000).fill(-.5);
  p.speak(a, 24000); for (let i = 0; i < 1000; i++) p.sample();
  assert.equal(p.sample(), .5); p.speak(b, 24000);
  assert.equal(p.current.samples, a); assert.equal(p.sample(), .5);
  let previous = .5, maxJump = 0;
  for (let i = 0; i < 600; i++) { const value = p.sample(); maxJump = Math.max(maxJump, Math.abs(value - previous)); previous = value; }
  assert.ok(maxJump < .005, maxJump); assert.equal(p.current.samples, b);
  p.speak(a, 24000); p.speak(b, 24000); p.stop();
  for (let i = 0; i < 300; i++) p.sample();
  assert.equal(p.current, null); assert.equal(p.pending, null); assert.equal(p.sample(), 0);
  assert.equal(p.speak(new Float32Array(24000 * 31), 24000), false);
});

test('native sample-rate playback preserves duration and releases its PCM', () => {
  const p = new SpiderSpeechPlayer(48000); p.speak(new Float32Array(22050).fill(.1), 22050);
  for (let i = 0; i < 47999; i++) p.sample();
  assert.ok(p.current); p.sample(); p.sample(); assert.equal(p.current, null);
});

function harness() {
  const workers = [], messages = [], statuses = [];
  class Worker {
    constructor() { workers.push(this); }
    postMessage(value) { this.request = value; this.deliver = data => this.onmessage?.({ data }); }
    terminate() { this.terminated = true; }
  }
  const audio = new SpiderSynthAudio({ runtime: { Worker }, onStatus: s => statuses.push(s) });
  audio.node = { port: { postMessage: message => messages.push(message), close() {} }, disconnect() {} };
  audio.context = { currentTime: 0, state: 'running', close: async () => {} };
  const ready = () => ({ type: 'ready', samples: new Float32Array(2400).fill(.1), sampleRate: 24000 });
  return { audio, workers, messages, statuses, ready };
}

test('speech never arms Audio; new requests, disable and dispose cancel workers and cannot revive stale speech', async () => {
  const { audio, workers, messages, ready } = harness();
  assert.equal(await audio.speak('hello'), false); assert.equal(workers.length, 0);
  audio.enabled = audio.ready = true;
  const first = audio.speak('first'), old = workers[0].onmessage;
  const second = audio.speak('second'); assert.equal(workers[0].terminated, true);
  old({ data: ready() }); workers[1].deliver(ready());
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(messages.filter(m => m.type === 'speak').length, 1);
  assert.equal(workers[1].request.values.language, 'en-gb'); assert.equal(workers[1].terminated, true);
  const third = audio.speak('third'), late = workers[2].onmessage; audio.disable(); late({ data: ready() });
  assert.equal(await third, false); assert.equal(workers[2].terminated, true);
  audio.enabled = true; const fourth = audio.speak('fourth'); audio.dispose();
  assert.equal(await fourth, false); assert.equal(workers[3].terminated, true);
  assert.equal(messages.filter(m => m.type === 'speak').length, 1);
});

test('native failure and graph replacement leave other sound layers available', async () => {
  const { audio, workers, messages, statuses, ready } = harness(); audio.enabled = audio.ready = true;
  const failed = audio.speak('test'); workers[0].deliver({ type: 'error', message: 'load failed' });
  assert.equal(await failed, false); assert.ok(statuses.some(s => s.includes('other sound layers remain playable')));
  assert.equal(audio.enabled, true); assert.equal(audio.ready, true);
  const stale = audio.speak('test'); audio.node = { port: { postMessage: m => messages.push(m) } }; workers[1].deliver(ready());
  assert.equal(await stale, false); assert.equal(messages.some(m => m.type === 'speak'), false);
  const invalid = audio.speak('test'); workers[2].deliver({ ...ready(), samples: new Float32Array([NaN]) });
  assert.equal(await invalid, false); assert.equal(workers[2].terminated, true);
});
