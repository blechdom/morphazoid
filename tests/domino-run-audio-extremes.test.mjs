import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DominoAudio } from '../src/instruments/domino-run/domino-run-audio.js';
import { DOMINO_MATERIALS, renderImpact } from '../src/instruments/domino-run/domino-run-sound.js';
import { DominoMixer, MAX_DOMINO_EVENTS, MAX_DOMINO_VOICES } from '../src/instruments/domino-run/domino-run-processor.js';

const RATE = 24000;
const MATERIALS = Object.keys(DOMINO_MATERIALS);
const OPTIONS = { sampleRate: RATE, ring: .16, brightness: .5, seed: 1729 };
function color(samples) {
  let energy = 0, difference = 0;
  for (let i = 1; i < samples.length; i++) {
    energy += samples[i] ** 2;
    difference += (samples[i] - samples[i - 1]) ** 2;
  }
  return Math.sqrt(difference / Math.max(1e-30, energy));
}
function bridge({ preparationSeconds = 0 } = {}) {
  const mixer = new DominoMixer(RATE), audio = new DominoAudio();
  const messages = [];
  audio._armed = true;
  audio._context = { currentTime: 0, state: 'running', sampleRate: RATE };
  audio.mixer = { port: { postMessage(message) {
    messages.push({ ...message, data: undefined });
    if (message.type === 'buffer') { mixer.addBuffer(message); audio._context.currentTime += preparationSeconds; }
    else if (message.type === 'touch') mixer.touchBuffer(message.id);
    else if (message.type === 'events') mixer.enqueue(message.events);
    else if (message.type === 'stage') mixer.enqueue(message.events, { stage: true, batch: message.batch });
    else if (message.type === 'commit') mixer.commit(message.start, message.notBefore, message.batch);
    else if (message.type === 'cancel') mixer.cancelQueued();
    else if (message.type === 'silence') mixer.silence();
    else if (message.type === 'dispose') mixer.clear();
  } } };
  return { mixer, audio, messages };
}
function renderMixer(mixer, seconds, start = 0) {
  const frames = Math.ceil(seconds * RATE / 128) * 128, output = new Float32Array(frames);
  const left = new Float32Array(128), right = new Float32Array(128);
  for (let frame = 0; frame < frames; frame += 128) {
    mixer.process(left, right, start + frame / RATE);
    assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
    assert.ok(mixer.status.active <= MAX_DOMINO_VOICES && mixer.status.queued <= MAX_DOMINO_EVENTS);
    output.set(left, frame);
  }
  return output;
}
function extremeEvents(count = 1024) {
  // 45 quarter-octave size bins × 6 materials × both hit types exceeds the LRU.
  return Array.from({ length: count }, (_, i) => ({
    time: i * .001 / 12, material: MATERIALS[Math.floor(i / 90) % MATERIALS.length],
    height: 2 ** ((i % 45 - 20) / 4), type: Math.floor(i / 45) % 2 ? 'floor' : 'contact',
    energy: 1, pan: Math.sin(i), eventId: i,
  }));
}

test('pitch zero preserves the original dry PCM and zero-variation mixer output exactly', () => {
  const hashes = {
    stone: '84c718594bd8f1041086322e06a6acedd9cb720b825bb172dfefae087a234b60',
    wood: '02341296b48845bd0eb57d8b7630a513ff297f1abafdbb57eaaf851710f978bf',
    ceramic: 'b02f1e86ffaa6ebb799d4ff59ac616f2a05eebc72554d127ae0b806cc4d55eeb',
    glass: '9215d09e77cb265fccafb70d4046419c10bef5b812247acca81d0ee5ee431982',
    metal: '0c66f0f347560d4f02c0d998ece5b85f883b18dc6f215096d4f81c1c156a963b',
    plastic: 'e6a64a953fdfff5e341973f47711acf8b10f82f6bc9aaf45ae9ddf8d1ba0b061',
  };
  for (const material of MATERIALS) {
    const data = renderImpact(material, 1, 1, 'contact', { ...OPTIONS, pitch: 0 });
    assert.equal(createHash('sha256').update(Buffer.from(data.buffer)).digest('hex'), hashes[material], material);
    const mixer = new DominoMixer(RATE);
    mixer.addBuffer({ id: 1, sampleRate: RATE, data });
    mixer.enqueue([{ bufferId: 1, time: 0, rate: 1, gain: 1, pan: -1 }]);
    assert.deepEqual(renderMixer(mixer, data.length / RATE).subarray(0, data.length), data);
  }
});

test('continuous pitch reaches the actual mixer as lower and higher clacks without changing cadence', () => {
  for (const material of MATERIALS) {
    const colors = [];
    for (const pitch of [-36, 0, 36]) {
      const { audio, mixer } = bridge();
      audio.setParams({ pitch, soundVariation: 0, ring: .16, brightness: .5 });
      const event = audio._event({ material, height: 1, type: 'contact', pan: -1 }, 0);
      assert.equal(event.rate, 1); assert.equal(event.time, 0); assert.equal(event.pan, -1);
      mixer.enqueue([event]);
      const output = renderMixer(mixer, .2);
      colors.push(color(output));
      const total = output.reduce((sum, value) => sum + value * value, 0);
      const late = output.subarray(RATE * .1).reduce((sum, value) => sum + value * value, 0);
      assert.ok(late / total < .025, `${material}/${pitch}: transposition retains a dry attack`);
    }
    assert.ok(colors[0] < colors[1] * .75, `${material}: lower pitch reaches the mixer`);
    assert.ok(colors[2] > colors[1] * 1.06, `${material}: higher pitch reaches the mixer`);
  }
  const { audio, mixer } = bridge();
  audio.setParams({ pitch: .1 }); const a = audio._buffer({ height: 1 });
  audio.setParams({ pitch: .2 }); const b = audio._buffer({ height: 1 });
  assert.notDeepEqual(mixer.buffers.get(a.bufferId).data, mixer.buffers.get(b.bufferId).data, 'fractional pitch is continuous');
  assert.equal(a.rate, b.rate);
});

test('height response extends below .2 and above 6 instead of flattening at old bounds', () => {
  for (const material of MATERIALS) {
    for (const [small, large] of [[.03, .2], [6, 64]]) {
      const a = renderImpact(material, small, 1, 'floor', OPTIONS);
      const b = renderImpact(material, large, 1, 'floor', OPTIONS);
      assert.notDeepEqual(a, b, `${material}/${small}/${large}: size changes the rendered sound`);
      assert.ok(color(a) > color(b) * 1.1, `${material}/${small}/${large}: larger pieces make lower thuds`);
    }
  }
});

test('all extreme pitches and sizes stay finite, bounded and finite in duration at native sample rates', () => {
  for (const material of MATERIALS) for (const height of [.03, 64]) for (const pitch of [-36, 36]) {
    for (const sampleRate of [8000, RATE, 48000]) for (const type of ['contact', 'floor']) {
      const data = renderImpact(material, height, 2, type, { sampleRate, pitch, ring: 1, brightness: 1 });
      assert.ok(data.length <= Math.ceil(sampleRate * 1.25));
      assert.ok(data.every(sample => Number.isFinite(sample) && Math.abs(sample) < 1));
      assert.ok(data.some(sample => Math.abs(sample) > .00001));
      assert.equal(data[0], 0); assert.equal(data.at(-1), 0);
    }
  }
});

test('1024 mixed extreme-size impacts at 12x retain their buffers through preparation and play within bounds', () => {
  const { audio, mixer, messages } = bridge();
  audio.setParams({ pitch: 36, soundVariation: 1, ring: .16 });
  const start = audio.queue(extremeEvents());
  assert.ok(messages.filter(message => message.type === 'buffer').length > 256, 'fixture crosses the LRU limit');
  assert.ok(messages.some(message => message.type === 'stage'));
  assert.equal(mixer.status.queued, 1024); assert.equal(mixer.status.dropped, 0);
  assert.equal(mixer.status.buffers, 256); assert.equal(audio.cache.size, 256);
  assert.equal(mixer.status.played, 0, 'preparation does not launch attacks before commit');
  const output = renderMixer(mixer, 1.6, start);
  assert.ok(output.some(sample => Math.abs(sample) > .001));
  assert.equal(mixer.status.played, 1024); assert.equal(mixer.status.dropped, 0);
  assert.ok(mixer.status.stolen > 0, 'dense scene exercises bounded voice replacement');
  assert.equal(mixer.status.active, 0); assert.equal(mixer.status.queued, 0);
});

test('staged live queues keep their anchor and skip expired attacks after cold preparation', () => {
  const { audio, mixer } = bridge({ preparationSeconds: .0005 });
  audio.context.currentTime = 10;
  const events = extremeEvents(512).map((event, i) => ({ ...event, time: i * .002 }));
  assert.equal(audio.queue(events, 10, { preserveStart: true }), 10);
  const expected = events.filter(event => 10 + event.time >= audio.context.currentTime);
  assert.equal(mixer.status.queued, expected.length);
  assert.deepEqual(mixer.events.map(event => event.time), expected.map(event => 10 + event.time));
  assert.equal(mixer.status.dropped, 0);
});

test('pending events share the queue bound and stale commits cannot revive cancelled or replaced batches', () => {
  const mixer = new DominoMixer(RATE);
  mixer.addBuffer({ id: 1, sampleRate: RATE, data: new Float32Array([0, .5, 0]) });
  const event = { bufferId: 1, time: 0, rate: 1, gain: 1, pan: -1 };
  mixer.enqueue(Array.from({ length: 100 }, () => event));
  mixer.enqueue(Array.from({ length: 4000 }, () => event), { stage: true, batch: 1 });
  assert.equal(mixer.status.queued, MAX_DOMINO_EVENTS); assert.equal(mixer.status.dropped, 4);
  for (const action of ['cancelQueued', 'silence', 'clear']) {
    mixer.addBuffer({ id: 1, sampleRate: RATE, data: new Float32Array([0, .5, 0]) });
    mixer.enqueue([event], { stage: true, batch: 4 });
    mixer[action]();
    mixer.commit(0, -Infinity, 4);
    assert.equal(mixer.status.queued, 0);
  }
  mixer.addBuffer({ id: 1, sampleRate: RATE, data: new Float32Array([0, .5, 0]) });
  mixer.enqueue([event], { stage: true, batch: 2 });
  mixer.cancelQueued();
  mixer.enqueue([event], { stage: true, batch: 3 });
  mixer.commit(100, -Infinity, 2);
  assert.equal(mixer.events.length, 0, 'stale commit does not retime the replacement batch');
  mixer.commit(.01, -Infinity, 3);
  mixer.commit(100, -Infinity, 3);
  assert.equal(mixer.events.length, 1); assert.equal(mixer.events[0].time, .01);
});

test('pitch edits and extreme queue requests never implicitly arm Audio', () => {
  let created = 0;
  const audio = new DominoAudio({ AudioContext: class { constructor() { created++; } } });
  assert.equal(audio.params.pitch, 0);
  audio.setParams({ pitch: -100 }); assert.equal(audio.params.pitch, -36);
  audio.setParams({ pitch: 100 }); assert.equal(audio.params.pitch, 36);
  audio.setParams({ pitch: NaN }); assert.equal(audio.params.pitch, 36);
  assert.equal(audio.queue(extremeEvents()), null); assert.equal(audio.prepare(extremeEvents()), 0);
  assert.equal(audio.play({ height: .03 }), false);
  assert.equal(created, 0); assert.equal(audio.armed, false);
});
