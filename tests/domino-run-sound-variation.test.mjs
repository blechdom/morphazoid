import test from 'node:test';
import assert from 'node:assert/strict';
import { DominoAudio, impactVariation } from '../src/instruments/domino-run/domino-run-audio.js';
import { DominoMixer, MAX_DOMINO_EVENTS, MAX_DOMINO_VOICES } from '../src/instruments/domino-run/domino-run-processor.js';
import { renderImpact } from '../src/instruments/domino-run/domino-run-sound.js';

const RATE = 24000;
function renderVoice(data, variation, { start = 0, blockSize = 128, gain = 0.6 } = {}) {
  const mixer = new DominoMixer(RATE);
  mixer.addBuffer({ id: 1, data, sampleRate: RATE });
  mixer.enqueue([{ bufferId: 1, time: start, rate: 1, gain: gain * variation.strength, pan: -1, variation }]);
  const output = new Float32Array(data.length + Math.ceil(start * RATE) + blockSize);
  const left = new Float32Array(blockSize); const right = new Float32Array(blockSize);
  for (let frame = 0; frame < output.length; frame += blockSize) {
    mixer.process(left, right, frame / RATE);
    output.set(left.subarray(0, Math.min(left.length, output.length - frame)), frame);
  }
  return output;
}
function features(samples) {
  let energy = 0; let derivative = 0; let early = 0; let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    energy += samples[i] ** 2;
    if (i < RATE * 0.02) early += samples[i] ** 2;
    if (i) derivative += (samples[i] - samples[i - 1]) ** 2;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  return { rms: Math.sqrt(early / (RATE * 0.02)), color: Math.sqrt(derivative / energy), peak };
}
const spread = (values) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) / mean;
};

test('zero variation preserves the existing impact PCM exactly with no onset or pitch change', () => {
  for (const material of ['stone', 'ceramic', 'plastic']) {
    const data = renderImpact(material, 1, 1, 'contact', { sampleRate: RATE, ring: 0.16 });
    const output = renderVoice(data, impactVariation(19, 0), { gain: 1 });
    assert.deepEqual(output.subarray(0, data.length), data);
    assert.ok(output.subarray(data.length).every((value) => value === 0));
    assert.deepEqual(impactVariation(19, 0), impactVariation('another hit', 0));
  }
});

test('variation depth creates measurable repeat-hit diversity while retaining the average level', () => {
  for (const material of ['stone', 'ceramic', 'plastic']) {
    const data = renderImpact(material, 1, 1, 'contact', { sampleRate: RATE, ring: 0.16 });
    const baseline = features(renderVoice(data, impactVariation(0, 0)));
    const gentle = []; const full = [];
    for (let hit = 0; hit < 64; hit += 1) {
      gentle.push(features(renderVoice(data, impactVariation(`hit:${hit}`, 0.2))));
      full.push(features(renderVoice(data, impactVariation(`hit:${hit}`, 1))));
    }
    assert.ok(spread(gentle.map((x) => x.rms)) > 0.015, `${material}: default has measurable strength/color variation`);
    assert.ok(spread(full.map((x) => x.rms)) > spread(gentle.map((x) => x.rms)) * 3, `${material}: depth changes spread`);
    assert.ok(spread(full.map((x) => x.color)) > 0.025, `${material}: timbre varies independently of level`);
    const average = full.reduce((sum, value) => sum + value.rms, 0) / full.length;
    assert.ok(average / baseline.rms > 0.88 && average / baseline.rms < 1.12, `${material}: average level remains comparable`);
  }
});

test('variation plans are reproducible and remain bounded without changing pitch, position or time', () => {
  for (let hit = 0; hit < 1000; hit += 1) {
    const plan = impactVariation(hit, 1);
    assert.deepEqual(plan, impactVariation(hit, 1));
    assert.ok(plan.strength >= 0.88 && plan.strength <= 1.12);
    assert.ok(Math.abs(plan.tilt) <= 0.45 && Math.abs(plan.attack) <= 0.2 && Math.abs(plan.body) <= 0.15);
    assert.equal('rate' in plan, false); assert.equal('time' in plan, false); assert.equal('pan' in plan, false);
  }
  const data = renderImpact('plastic', 1, 1, 'contact', { sampleRate: RATE, ring: 0.16 });
  const baseline = renderVoice(data, impactVariation(0, 0), { start: 0.012 });
  const first = baseline.findIndex((value) => value !== 0);
  for (let hit = 0; hit < 32; hit += 1) {
    const varied = renderVoice(data, impactVariation(hit, 1), { start: 0.012 });
    assert.equal(varied.findIndex((value) => value !== 0), first);
  }
});

test('per-hit shaping keeps the existing buffer cache and preserves recurring event identity on requeue', () => {
  const messages = [];
  const audio = new DominoAudio();
  audio._armed = true;
  audio._context = { currentTime: 0, state: 'running', sampleRate: RATE };
  audio.mixer = { port: { postMessage(message) { messages.push(message); } } };
  const event = { id: 3, eventId: 40, occurrenceId: 8, type: 'contact', material: 'plastic', height: 1, energy: 1, pan: 0.25 };
  audio.setParams({ soundVariation: 0 });
  const baseline = audio._event(event, 12);
  audio.setParams({ soundVariation: 1 });
  const first = audio._event(event, 12);
  const resumed = audio._event({ ...event }, 35);
  assert.deepEqual(first.variation, resumed.variation, 'clock translation preserves the same recurring strike color');
  assert.equal(first.rate, baseline.rate); assert.equal(first.time, baseline.time); assert.equal(first.pan, baseline.pan);
  const plans = [];
  for (let i = 0; i < 128; i += 1) plans.push(audio._event({ material: 'plastic', height: 1, id: 3 }, i).variation);
  assert.notDeepEqual(plans[0], plans[1], 'manual repeats receive different strike color');
  assert.equal(audio.cache.size, 1); assert.equal(messages.filter((x) => x.type === 'buffer').length, 1);
  audio.setParams({ soundVariation: -1 }); assert.equal(audio.params.soundVariation, 0);
  audio.setParams({ soundVariation: 2 }); assert.equal(audio.params.soundVariation, 1);
});

test('varied voices remain finite, dry, and bounded through dense strikes and release', () => {
  for (const material of ['stone', 'wood', 'ceramic', 'glass', 'metal', 'plastic']) {
    for (const type of ['contact', 'floor']) {
      const data = renderImpact(material, 0.3, 2, type, { sampleRate: RATE, ring: 0.16, brightness: 1 });
      for (const seed of [1, 17, 271]) {
        const output = renderVoice(data, impactVariation(seed, 1));
        assert.ok(output.every(Number.isFinite));
        assert.ok(features(output).peak < 1, `${material}/${type}: protected individual impact level`);
        let total = 0; let late = 0;
        for (let i = 0; i < output.length; i += 1) { total += output[i] ** 2; if (i > RATE * 0.1) late += output[i] ** 2; }
        assert.ok(late / total < 0.02, `${material}/${type}: variation retains dry decay`);
      }
    }
  }
  const mixer = new DominoMixer(RATE);
  mixer.addBuffer({ id: 1, sampleRate: RATE, data: renderImpact('stone', 1, 1, 'floor', { sampleRate: RATE, ring: 0.16 }) });
  mixer.enqueue(Array.from({ length: MAX_DOMINO_EVENTS + 10 }, (_, hit) => ({ bufferId: 1, time: 0, rate: 1, gain: 0.1,
    pan: 0, variation: impactVariation(hit, 1) })));
  const left = new Float32Array(128); const right = new Float32Array(128);
  mixer.process(left, right, 0);
  assert.equal(mixer.status.active, MAX_DOMINO_VOICES); assert.equal(mixer.status.dropped, 10);
  assert.ok(left.every(Number.isFinite)); assert.ok(right.every(Number.isFinite));
  mixer.silence();
  for (let frame = 128; frame < 640; frame += 128) mixer.process(left, right, frame / RATE);
  assert.equal(mixer.status.active, 0); assert.equal(mixer.status.queued, 0);
  assert.ok(left.every((value) => value === 0));
});

test('variation filters preserve sample continuity across render blocks', () => {
  const data = renderImpact('stone', 1, 1, 'floor', { sampleRate: RATE, ring: 0.16 });
  const plan = impactVariation(271, 1);
  const small = renderVoice(data, plan, { blockSize: 64 });
  const large = renderVoice(data, plan, { blockSize: 256 });
  assert.deepEqual(small.subarray(0, data.length), large.subarray(0, data.length));
});
