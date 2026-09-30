import test from 'node:test';
import assert from 'node:assert/strict';
import { DominoAudio } from '../src/instruments/domino-run/domino-run-audio.js';
import { DOMINO_MATERIALS, renderImpact } from '../src/instruments/domino-run/domino-run-sound.js';
import { DominoMixer, MAX_DOMINO_EVENTS, MAX_DOMINO_VOICES } from '../src/instruments/domino-run/domino-run-processor.js';

const rms = (samples, start = 0, end = samples.length) => {
  let total = 0;
  for (let i = Math.max(0, start); i < Math.min(samples.length, end); i += 1) total += samples[i] ** 2;
  return Math.sqrt(total / Math.max(1, end - start));
};
const spectralBrightness = (samples) => {
  let energy = 0; let difference = 0;
  for (let i = 1; i < samples.length; i += 1) {
    energy += samples[i] ** 2; difference += (samples[i] - samples[i - 1]) ** 2;
  }
  return Math.sqrt(difference / Math.max(1e-30, energy));
};

test('all material impacts are deterministic, finite, bounded and decay to silence', () => {
  for (const material of Object.keys(DOMINO_MATERIALS)) {
    for (const type of ['contact', 'floor']) {
      const parameters = { sampleRate: 24000, ring: 0.7, seed: 13 };
      const samples = renderImpact(material, 1.2, 2, type, parameters);
      assert.deepEqual(samples, renderImpact(material, 1.2, 2, type, parameters));
      assert.ok(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 1), material);
      assert.ok(rms(samples, 0, 1000) > 0.005, `${material} has an audible onset`);
      assert.ok(rms(samples, samples.length - 600) < rms(samples, 0, 1000) * 0.025, `${material} decays`);
      assert.equal(samples[0], 0); assert.equal(samples.at(-1), 0);
    }
  }
});

test('zero energy is silent; force, ring and brightness have measurable sound consequences', () => {
  assert.ok(renderImpact('stone', 1, 0).every((x) => x === 0));
  const quiet = renderImpact('stone', 1, 0.15);
  const strong = renderImpact('stone', 1, 1.5);
  assert.ok(rms(strong, 0, 1200) > rms(quiet, 0, 1200) * 2);
  const dry = renderImpact('metal', 1, 1, 'contact', { ring: 0 });
  const ringing = renderImpact('metal', 1, 1, 'contact', { ring: 1 });
  assert.ok(rms(ringing, 2400, 4800) > rms(dry, 2400, 4800) * 5);
  const dark = renderImpact('ceramic', 1, 1, 'contact', { brightness: 0 });
  const bright = renderImpact('ceramic', 1, 1, 'contact', { brightness: 1 });
  const roughness = (a) => {
    let energy = 0; let difference = 0;
    for (let i = 1; i < Math.min(4000, a.length); i += 1) { energy += a[i] ** 2; difference += (a[i] - a[i - 1]) ** 2; }
    return difference / energy;
  };
  assert.ok(roughness(bright) > roughness(dark) * 1.5);
});

test('size gently darkens an impact and the floor is broader and lower than contact', () => {
  const options = { sampleRate: 24000, ring: 0.16 };
  for (const material of ['stone', 'ceramic', 'plastic']) {
    const average = (height, type) => [1, 17, 271].reduce((total, seed) => total + spectralBrightness(
      renderImpact(material, height, 1, type, { ...options, seed })), 0) / 3;
    const small = average(0.65, 'contact'); const big = average(1.7, 'contact');
    assert.ok(small > big * 1.03 && small < big * 1.65, `${material}: subtle size coloration`);
    assert.ok(average(1, 'contact') > average(1, 'floor') * 1.7, `${material}: contact/floor contrast`);
  }
});

test('material voices retain distinct spectral color and optional ringing texture', () => {
  const average = (material, type = 'contact') => [1, 17, 271].reduce((total, seed) => total + spectralBrightness(
    renderImpact(material, 1, 1, type, { sampleRate: 24000, ring: 0.16, seed })), 0) / 3;
  assert.ok(average('ceramic') > average('stone') * 1.1, 'ceramic contact has a sharper edge');
  assert.ok(average('plastic') > average('wood') * 1.1, 'plastic clack is brighter than wood');
  assert.ok(average('glass', 'floor') > average('stone', 'floor') * 1.3, 'glass remains distinct from a stone thud');
  const metallic = renderImpact('metal', 1, 1, 'contact', { ring: 1 });
  const plastic = renderImpact('plastic', 1, 1, 'contact', { ring: 1 });
  assert.ok(rms(metallic, 2400, 4800) > rms(plastic, 2400, 4800) * 3, 'upper Ring retains metallic color');
});

test('extreme and malformed sound parameters remain finite and resource bounded', () => {
  for (const material of Object.keys(DOMINO_MATERIALS)) {
    const samples = renderImpact(material, Infinity, NaN, 'floor', { ring: 8, brightness: -7, sampleRate: 8000, seed: NaN });
    assert.ok(samples.length <= 24000);
    assert.ok(samples.every((x) => Number.isFinite(x) && Math.abs(x) < 1));
  }
});

test('worklet mixer begins at the requested sample and preserves stereo position', () => {
  const mixer = new DominoMixer(8000);
  mixer.addBuffer({ id: 1, sampleRate: 8000, data: new Float32Array([0, 0.5, 0.25, 0]) });
  mixer.enqueue([{ bufferId: 1, time: 0.01, rate: 1, gain: 1, pan: -1 }]);
  const left = new Float32Array(128); const right = new Float32Array(128);
  mixer.process(left, right, 0);
  assert.ok(left.slice(0, 81).every((x) => x === 0));
  assert.equal(left[81], 0.5); assert.equal(left[82], 0.25);
  assert.ok(right.every((x) => Math.abs(x) < 1e-8));
  assert.equal(mixer.status.played, 1);
});

test('full-run scheduling separates future events from the bounded active voice pool', () => {
  const mixer = new DominoMixer(8000);
  mixer.addBuffer({ id: 1, sampleRate: 8000, data: new Float32Array(2000).fill(0.1) });
  mixer.enqueue(Array.from({ length: 512 }, (_, i) => ({ bufferId: 1, time: 1 + i * 0.01, rate: 1, gain: 0.3, pan: 0 })));
  const left = new Float32Array(128); const right = new Float32Array(128);
  mixer.process(left, right, 0);
  assert.equal(mixer.status.queued, 512); assert.equal(mixer.status.active, 0);
  assert.ok(left.every((x) => x === 0));
  for (let block = 1; block < 450; block += 1) mixer.process(left, right, block * 128 / 8000);
  assert.equal(mixer.status.played, 512); assert.equal(mixer.status.dropped, 0);
  assert.equal(mixer.status.queued, 0); assert.equal(mixer.status.active, 0);
});

test('mixer caps queues/voices, crossfades dense attacks, and silence removes future events', () => {
  const mixer = new DominoMixer(8000);
  mixer.addBuffer({ id: 1, sampleRate: 8000, data: new Float32Array(3000).fill(0.1) });
  mixer.enqueue(Array.from({ length: MAX_DOMINO_EVENTS + 20 }, () => ({ bufferId: 1, time: 0, rate: 1, gain: 0.3, pan: 0 })));
  assert.equal(mixer.status.queued, MAX_DOMINO_EVENTS); assert.equal(mixer.status.dropped, 20);
  const left = new Float32Array(128); const right = new Float32Array(128);
  mixer.process(left, right, 0);
  assert.equal(mixer.status.active, MAX_DOMINO_VOICES);
  assert.ok(left.every(Number.isFinite)); assert.ok(mixer.status.stolen > 0);
  mixer.enqueue([{ bufferId: 1, time: 10, rate: 1, gain: 0.3, pan: 0 }]);
  mixer.silence();
  assert.equal(mixer.status.queued, 0);
  mixer.process(left, right, 128 / 8000);
  assert.equal(mixer.status.active, 0);
  mixer.process(left, right, 256 / 8000);
  assert.ok(left.every((x) => x === 0));
});

test('Play, queue and parameter edits cannot implicitly arm Audio', async () => {
  let contexts = 0;
  const audio = new DominoAudio({ AudioContext: class { constructor() { contexts += 1; } } });
  assert.equal(audio.play({ material: 'stone' }), false);
  assert.equal(audio.queue([{ time: 0, material: 'wood' }]), null);
  audio.setLevel(0.8); audio.setParams({ ring: 0.9 });
  assert.equal(contexts, 0); assert.equal(audio.armed, false);
  await audio.dispose();
});

test('buffer eviction is bounded and preserves cached hits and already queued sounds', () => {
  const mixer = new DominoMixer(8000);
  const data = new Float32Array([0, 0.4, 0]);
  for (let id = 0; id < 256; id += 1) mixer.addBuffer({ id, data, sampleRate: 8000 });
  mixer.touchBuffer(0);
  mixer.addBuffer({ id: 256, data, sampleRate: 8000 });
  assert.ok(mixer.buffers.has(0)); assert.equal(mixer.buffers.has(1), false);
  mixer.enqueue([{ bufferId: 0, time: 1, rate: 1, gain: 1, pan: 0 }]);
  for (let id = 257; id < 600; id += 1) mixer.addBuffer({ id, data, sampleRate: 8000 });
  assert.equal(mixer.status.buffers, 256); assert.equal(mixer.buffers.has(0), false);
  const left = new Float32Array(128); const right = new Float32Array(128);
  mixer.process(left, right, 1);
  assert.ok(left[1] > 0.28, 'queued events retain their buffer after cache eviction');
  assert.equal(mixer.status.played, 1); assert.equal(mixer.status.dropped, 0);
});

test('cancelQueued removes future impacts without shortening or altering an audible tail', () => {
  const data = Float32Array.from({ length: 2400 }, (_, i) => Math.sin(i * 0.2) * Math.exp(-i / 1200) * 0.2);
  const cancelled = new DominoMixer(8000); const uninterrupted = new DominoMixer(8000);
  const left = new Float32Array(128); const right = new Float32Array(128);
  const referenceLeft = new Float32Array(128); const referenceRight = new Float32Array(128);
  for (const mixer of [cancelled, uninterrupted]) {
    mixer.addBuffer({ id: 1, sampleRate: 8000, data });
    mixer.enqueue([0, 0.12].map((time) => ({ bufferId: 1, time, rate: 1, gain: 1, pan: 0.3 })));
    mixer.process(left, right, 0);
  }
  cancelled.cancelQueued();
  assert.equal(cancelled.status.queued, 0); assert.equal(cancelled.status.active, 1);
  cancelled.process(left, right, 128 / 8000);
  uninterrupted.process(referenceLeft, referenceRight, 128 / 8000);
  assert.deepEqual(left, referenceLeft); assert.deepEqual(right, referenceRight);
  assert.ok(rms(left) > 0.01, 'current resonance continues beyond the mute release duration');
  for (let block = 2; block < 40; block += 1) {
    cancelled.process(left, right, block * 128 / 8000);
    uninterrupted.process(referenceLeft, referenceRight, block * 128 / 8000);
  }
  assert.equal(cancelled.status.played, 1); assert.equal(uninterrupted.status.played, 2);
  assert.equal(cancelled.status.active, 0);
});

test('live queue replacement preserves its clock through preparation and skips expired attacks', () => {
  const messages = [];
  const audio = new DominoAudio();
  audio._armed = true;
  audio._context = { state: 'running', currentTime: 10, sampleRate: 48000 };
  audio.mixer = { port: { postMessage(message) {
    messages.push(message);
    // Simulate time consumed preparing three previously unheard materials.
    if (message.type === 'buffer') audio._context.currentTime += 0.08;
  } } };
  audio.cancelQueued();
  assert.equal(messages[0].type, 'cancel');
  const anchor = audio.queue([
    { time: 0.05, material: 'stone' },
    { time: 0.2, material: 'glass' },
    { time: 0.8, material: 'metal' },
  ], 10, { preserveStart: true });
  assert.equal(anchor, 10);
  const scheduled = messages.at(-1).events;
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].time, 10.8);
  assert.ok(scheduled.every((event) => event.time >= audio.context.currentTime));
  const freshStart = audio.queue([{ time: 0, material: 'stone' }], 10);
  assert.ok(freshStart >= audio.context.currentTime + 0.04);
  assert.equal(messages.at(-1).events.length, 1);
});
