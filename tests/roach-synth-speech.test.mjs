import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { RoachSynthAudio } from '../src/instruments/roach-synth/roach-synth-audio.js';
import { RoachSynthDsp, createDefaultRoachBodyMix, validateRoachSpeechBuffer } from '../src/instruments/roach-synth/roach-synth-dsp.js';
import { renderNativeText } from '../src/families/speech/native-text.js';
import { nativeTextDefaults } from '../src/families/speech/native-text-controls.js';

const RATE = 24000;
const phrase = (sampleRate = 22050, seconds = 2.2, frequency = 173) => Float32Array.from(
  { length: Math.round(sampleRate * seconds) }, (_, i) =>
    (Math.sin(i * Math.PI * 2 * frequency / sampleRate) + .35 * Math.sin(i * Math.PI * 2 * frequency * 3 / sampleRate)) * .2);
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
const peak = samples => samples.reduce((highest, value) => Math.max(highest, Math.abs(value)), 0);
function engine(sound = {}) {
  const dsp = new RoachSynthDsp(RATE);
  dsp.update({ enabled: true, playing: false, soundPlaying: false, mappings: [],
    motion: { presetId: 'none', antennae: false }, sound: { pitch: 140, voice: 1, ...sound },
    bodyMix: createDefaultRoachBodyMix().map(row => ({ ...row, level: 0 })) });
  return dsp;
}
function render(dsp, seconds) {
  const left = new Float32Array(Math.round(RATE * seconds)), right = new Float32Array(left.length);
  for (let start = 0; start < left.length; start += 128) dsp.render(left.subarray(start, start + 128), right.subarray(start, start + 128));
  return left;
}
function fixture() {
  const contexts = [], messages = [], workers = [], statuses = [], timers = new Map(), fetches = [];
  let nextTimer = 0;
  class Node {
    constructor() { this.gain = { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } }; }
    connect() {} disconnect() {}
  }
  class Context {
    constructor() { this.currentTime = 0; this.state = 'suspended'; this.destination = new Node();
      this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createGain() { return new Node(); }
  }
  class Worklet extends Node {
    constructor() { super(); this.port = { close() {}, postMessage(data, transfer) { messages.push({ data, transfer }); } }; }
  }
  class Worker {
    constructor(url, options) { this.url = url; this.options = options; this.terminated = 0; workers.push(this); }
    postMessage(data) { this.request = structuredClone(data); this.receive = this.onmessage; }
    terminate() { this.terminated++; }
    ready(samples = phrase(), sampleRate = 22050) { this.receive?.({ data: { type: 'ready', samples, sampleRate } }); }
  }
  const runtime = { AudioContext: Context, AudioWorkletNode: Worklet, Worker,
    performance: { now: () => 0 }, fetch: async url => { fetches.push(String(url)); return { ok: false }; },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const audio = new RoachSynthAudio({ runtime, onStatus: status => statuses.push(status) });
  return { audio, contexts, messages, workers, statuses, timers, fetches };
}
const speechMessages = f => f.messages.filter(message => message.data.type === 'speech-buffer');

test('speech is explicitly armed, uses one audio graph, transfers full PCM and preserves performance state', async () => {
  const f = fixture(), { audio } = f;
  try {
    assert.equal(await audio.speak('hello roach'), false);
    assert.equal(f.contexts.length, 0); assert.equal(f.workers.length, 0);
    await audio.enable({ time: 7, playing: false, soundPlaying: false, sound: { level: .23, voice: .41 } });
    const before = structuredClone(audio.state), master = audio.master;
    const pending = audio.speak('  hello little cockroach, I live in your house  ');
    const worker = f.workers[0], samples = phrase();
    assert.match(worker.url.pathname, /roach-synth-speech-worker\.js$/);
    assert.deepEqual(worker.options, { type: 'module' });
    assert.deepEqual(worker.request, { text: 'hello little cockroach, I live in your house' });
    assert.equal([...f.timers.values()][0].delay, 30000);
    worker.ready(samples); assert.equal(await pending, true);
    assert.equal(worker.terminated, 1); assert.equal(f.timers.size, 0); assert.equal(audio.cancelSpeechRender, null);
    assert.equal(f.contexts.length, 1); assert.equal(audio.master, master);
    assert.deepEqual(audio.state, before); assert.equal(audio.getTime(), 7);
    const posted = speechMessages(f);
    assert.equal(posted.length, 1); assert.equal(posted[0].data.samples, samples);
    assert.equal(posted[0].data.sampleRate, 22050); assert.deepEqual(posted[0].transfer, [samples.buffer]);
    assert.ok(f.fetches.every(url => !url.includes('spelling') && !url.includes('dictionary')));
    assert.ok(f.statuses.every(status => !/is speaking/i.test(status)));
  } finally { audio.dispose(); }
});

test('replacing a pending render terminates it and ignores its late PCM', async () => {
  const f = fixture(), { audio } = f;
  try {
    await audio.enable();
    const first = audio.speak('first phrase'), oldWorker = f.workers.at(-1);
    const latest = audio.speak('latest phrase'), worker = f.workers.at(-1);
    assert.equal(await first, false); assert.equal(oldWorker.terminated, 1);
    oldWorker.ready(); assert.equal(speechMessages(f).length, 0);
    worker.ready(); assert.equal(await latest, true);
    assert.equal(speechMessages(f).length, 1); assert.equal(f.timers.size, 0);
  } finally { audio.dispose(); }
});

for (const action of ['disable', 'dispose', 'processorerror']) test(`${action} cancels native rendering; rearm cannot play its late sentence`, async () => {
  const f = fixture(), { audio } = f;
  try {
    await audio.enable(); const pending = audio.speak('unfinished sentence'), worker = f.workers.at(-1);
    if (action === 'processorerror') audio.node.onprocessorerror(); else audio[action]();
    assert.equal(await pending, false); assert.equal(worker.terminated, 1); assert.equal(f.timers.size, 0);
    if (action !== 'dispose') await audio.enable();
    worker.ready(); assert.equal(speechMessages(f).length, 0);
    assert.equal(f.workers.length, 1); assert.equal(f.contexts.length, 1);
  } finally { audio.dispose(); }
});

for (const changed of ['context', 'node', 'suspended']) test(`completed PCM cannot reach a changed ${changed}`, async () => {
  const f = fixture(), { audio } = f;
  try {
    await audio.enable(); const pending = audio.speak('old destination'), worker = f.workers.at(-1);
    if (changed === 'context') audio.context = { ...audio.context, close: async () => {} };
    else if (changed === 'node') audio.node = { ...audio.node, disconnect() {} };
    else audio.context.state = 'suspended';
    worker.ready(); assert.equal(await pending, false); assert.equal(speechMessages(f).length, 0);
    assert.equal(worker.terminated, 1); assert.equal(f.timers.size, 0);
    if (changed === 'suspended') {
      assert.match(f.statuses.at(-1), /Tap Audio again/);
      assert.equal(await audio.speak('still suspended'), false); assert.equal(f.workers.length, 1);
      assert.equal(audio.context.state, 'suspended');
    }
  } finally { audio.dispose(); }
});

test('timeout and engine failure retire speech resources while leaving the audio graph playable', async () => {
  const f = fixture(), { audio } = f;
  try {
    await audio.enable(); const master = audio.master;
    const timedOut = audio.speak('slow phrase'), oldWorker = f.workers.at(-1);
    [...f.timers.values()][0].callback(); assert.equal(await timedOut, false);
    assert.equal(oldWorker.terminated, 1); assert.match(f.statuses.at(-1), /timed out/);
    oldWorker.ready(); assert.equal(speechMessages(f).length, 0);
    const failed = audio.speak('broken phrase'), worker = f.workers.at(-1);
    worker.receive({ data: { type: 'error', message: 'native failure' } }); assert.equal(await failed, false);
    assert.equal(worker.terminated, 1); assert.match(f.statuses.at(-1), /native failure/);
    assert.equal(audio.master, master); assert.equal(audio.enabled, true); assert.equal(audio.ready, true);
    const good = audio.speak('a fresh phrase'); f.workers.at(-1).ready(); assert.equal(await good, true);
  } finally { audio.dispose(); }
});

test('invalid native PCM is rejected before the worklet; user text is bounded and empty text creates no worker', async () => {
  const f = fixture(), { audio } = f;
  try {
    await audio.enable(); assert.equal(await audio.speak(' '), false); assert.equal(f.workers.length, 0);
    for (const [samples, rate] of [[new Float64Array([.1]), 22050], [new Float32Array(), 22050],
      [new Float32Array([NaN]), 22050], [new Float32Array([Infinity]), 22050], [new Float32Array([1.01]), 22050],
      [phrase(), 0], [phrase(), 22050.5], [phrase(), 192001], [new Float32Array(8000 * 30 + 1), 8000],
      [new Float32Array(new ArrayBuffer(8000 * 30 * 4 + 4), 0, 1), 8000],
      [new Float32Array(new SharedArrayBuffer(4)), 22050]]) {
      const pending = audio.speak('invalid sentence'); f.workers.at(-1).ready(samples, rate);
      assert.equal(await pending, false); assert.equal(f.workers.at(-1).terminated, 1);
      assert.equal(speechMessages(f).length, 0); assert.equal(f.timers.size, 0);
    }
    const pending = audio.speak('x'.repeat(1000)); assert.equal(f.workers.at(-1).request.text.length, 180);
    f.workers.at(-1).ready(); assert.equal(await pending, true);
  } finally { audio.dispose(); }
});

test('missing workers, worker exceptions and unreadable messages fail speech without disarming Audio', async () => {
  const f = fixture(), { audio } = f;
  try {
    await audio.enable(); const Worker = audio.runtime.Worker;
    audio.runtime.Worker = undefined; assert.equal(await audio.speak('no worker'), false);
    assert.equal(f.workers.length, 0); assert.match(f.statuses.at(-1), /support voice workers/);
    audio.runtime.Worker = Worker;
    for (const event of ['onerror', 'onmessageerror']) {
      const pending = audio.speak('failed worker'), worker = f.workers.at(-1);
      worker[event]({ message: 'worker failed to load' });
      assert.equal(await pending, false); assert.equal(worker.terminated, 1); assert.equal(f.timers.size, 0);
      assert.equal(audio.enabled, true); assert.equal(audio.ready, true); assert.equal(speechMessages(f).length, 0);
    }
  } finally { audio.dispose(); }
});

test('PCM speech plays past the old phone limit, keeps paused clocks and returns to silence', () => {
  const dsp = engine(); const samples = phrase();
  assert.equal(dsp.speakBuffer(samples, 22050), true); assert.equal(dsp.speechBuffer, samples);
  const output = render(dsp, 2.7);
  assert.ok(rms(output.slice(RATE, RATE * 1.3)) > .005, 'middle of the complete sentence must remain audible');
  assert.ok(rms(output.slice(-RATE / 5)) < 1e-6); assert.ok(output.every(Number.isFinite)); assert.ok(peak(output) < .95);
  assert.equal(dsp.time, 0); assert.equal(dsp.soundTime, 0); assert.equal(dsp.speechBuffer, null);
  assert.ok(dsp.speechEnvelope < .0001);
});

test('voice level, vowel color and pitch still shape native PCM independently of transport', () => {
  function sound(patch) { const dsp = engine(patch); dsp.speakBuffer(phrase(), 22050); return render(dsp, 1); }
  const normal = sound({ voice: 1 }), quiet = sound({ voice: .05 }), silent = sound({ voice: 0 });
  assert.ok(rms(quiet) < rms(normal) * .2); assert.equal(rms(silent), 0);
  for (const changed of [sound({ vowel: 0 }), sound({ pitch: 460 })]) {
    assert.ok(rms(normal.map((value, i) => value - changed[i])) > .001);
  }
});

test('PCM replacement releases the old sentence and Audio mute/rearm cannot resurrect unsampled speech', () => {
  const dsp = engine(); dsp.speakBuffer(phrase(), 22050); render(dsp, .1);
  const next = phrase(16000, .3, 347); dsp.speakBuffer(next, 16000);
  assert.equal(dsp.pendingSpeech.samples, next); render(dsp, .04);
  assert.equal(dsp.pendingSpeech, null); assert.equal(dsp.speechBuffer, next);
  render(dsp, .4); assert.ok(rms(render(dsp, .2)) < 1e-6);
  dsp.speakBuffer(phrase(), 22050);
  dsp.update({ enabled: false }); dsp.update({ enabled: true });
  assert.equal(dsp.speechBuffer, null); assert.equal(dsp.pendingSpeech, null);
  assert.ok(rms(render(dsp, .3)) < 1e-6);
  dsp.speakBuffer(phrase(), 22050); render(dsp, .1);
  dsp.update({ enabled: false }); assert.equal(dsp.speakBuffer(next, 16000), false);
  render(dsp, .4); dsp.update({ enabled: true }); assert.ok(rms(render(dsp, .3)) < 1e-6);
});

test('PCM validation rejects nonfinite or oversized samples without replacing a sounding phrase', () => {
  const dsp = engine(), samples = phrase(); dsp.speakBuffer(samples, 22050);
  assert.throws(() => dsp.speakBuffer(new Float32Array([NaN]), 22050), /invalid samples/);
  assert.throws(() => dsp.speakBuffer(new Float32Array(8000 * 30 + 1), 8000), /fixed budget/);
  assert.equal(dsp.speechBuffer, samples); assert.equal(dsp.pendingSpeech, null);
  assert.equal(validateRoachSpeechBuffer(samples, 22050), samples);
});

test('the authored speech worker uses complete eSpeak croak controls once and transfers the renderer PCM', async () => {
  const source = readFileSync(new URL('../src/instruments/roach-synth/roach-synth-speech-worker.js', import.meta.url), 'utf8');
  const requests = [], replies = [], samples = phrase();
  const self = { postMessage(data, transfer) { replies.push({ data, transfer }); } };
  const renderNativeText = async (...args) => { requests.push(args); return { samples, sampleRate: 22050 }; };
  // Execute the authored worker handler with only its native render dependency replaced.
  Function('renderNativeText', 'nativeTextDefaults', 'self', source.replace(/^import .+;\n/gm, ''))(renderNativeText, nativeTextDefaults, self);
  await self.onmessage({ data: { text: '  hello little bug  ', values: { volume: 0 } } });
  await self.onmessage({ data: { text: 'a duplicate request' } });
  assert.equal(requests.length, 1); assert.equal(requests[0][0], 'espeak'); assert.equal(requests[0][1], 'hello little bug');
  assert.deepEqual(requests[0][2], { ...nativeTextDefaults('espeak'), variant: 'croak', rate: 190, pitch: 38, range: 28, volume: 100 });
  assert.deepEqual(replies, [{ data: { type: 'ready', samples, sampleRate: 22050 }, transfer: [samples.buffer] }]);
});

test('the bundled Voicesaurus croak voice renders a complete sentence through the Roach speech bus', async () => {
  const source = readFileSync(new URL('../src/instruments/roach-synth/roach-synth-speech-worker.js', import.meta.url), 'utf8');
  const replies = [], self = { postMessage: data => replies.push(data) };
  Function('renderNativeText', 'nativeTextDefaults', 'self', source.replace(/^import .+;\n/gm, ''))(renderNativeText, nativeTextDefaults, self);
  await self.onmessage({ data: { text: "hi, I'm a cockroach and I live in your house" } });
  assert.equal(replies.length, 1); assert.equal(replies[0].type, 'ready');
  const { samples, sampleRate } = replies[0];
  validateRoachSpeechBuffer(samples, sampleRate);
  assert.ok(samples.length / sampleRate > .65, 'native sentence must exceed the old single-phone duration');
  assert.ok(rms(samples) > .005); assert.ok(peak(samples) < 1);
  const dsp = engine(); dsp.speakBuffer(samples, sampleRate);
  const output = render(dsp, samples.length / sampleRate + .4);
  assert.ok(rms(output.slice(RATE, Math.round(RATE * 1.3))) > .005);
  assert.ok(output.every(Number.isFinite)); assert.ok(peak(output) < .95);
  assert.ok(rms(output.slice(-RATE / 5)) < 1e-6);
  assert.equal(dsp.speechBuffer, null); assert.equal(dsp.time, 0); assert.equal(dsp.soundTime, 0);
});

test('the authored processor routes PCM through the existing speech telemetry and output graph', () => {
  const source = readFileSync(new URL('../src/instruments/roach-synth/roach-synth-processor.js', import.meta.url), 'utf8');
  let Processor;
  class Base { constructor() { this.port = { postMessage: data => this.messages.push(data) }; this.messages = []; } }
  Function('RoachSynthDsp', 'AudioWorkletProcessor', 'sampleRate', 'currentTime', 'registerProcessor',
    source.replace(/^import .+;\n/gm, ''))(RoachSynthDsp, Base, RATE, 0, (_name, Class) => { Processor = Class; });
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'state', state: { enabled: true, playing: false, soundPlaying: false,
    sound: { voice: 1 }, bodyMix: createDefaultRoachBodyMix().map(row => ({ ...row, level: 0 })) } } });
  processor.port.onmessage({ data: { type: 'speech-buffer', samples: phrase(), sampleRate: 22050 } });
  const left = new Float32Array(RATE), right = new Float32Array(RATE);
  assert.equal(processor.process([], [[left, right]]), true);
  assert.ok(rms(left) > .005); assert.ok(left.every(Number.isFinite)); assert.ok(peak(left) < .95);
  assert.ok(processor.messages.some(message => message.type === 'telemetry' && message.speechEnvelope > .001));
  processor.port.onmessage({ data: { type: 'dispose' } }); assert.equal(processor.process([], [[left, right]]), false);
});
