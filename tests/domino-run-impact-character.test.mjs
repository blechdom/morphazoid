import test from 'node:test';
import assert from 'node:assert/strict';
import { DominoAudio } from '../src/instruments/domino-run/domino-run-audio.js';
import { renderImpact } from '../src/instruments/domino-run/domino-run-sound.js';

const RATE = 24000;
const SEEDS = [1, 17, 271];
const MATERIALS = ['stone', 'ceramic', 'plastic'];
function characterize(samples) {
  let energy = 0; let after50 = 0; let after100 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    energy += samples[i] ** 2;
    if (i >= RATE * 0.05) after50 += samples[i] ** 2;
    if (i >= RATE * 0.1) after100 += samples[i] ** 2;
  }
  let sum = 0; let t95 = samples.length / RATE;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] ** 2;
    if (sum >= energy * 0.95) { t95 = i / RATE; break; }
  }
  return { t95, after50: after50 / energy, after100: after100 / energy };
}
// A spectral periodicity proxy, not a claim about perceptual realism. Interior
// autocorrelation maxima avoid calling the smooth shoulder of low-passed noise
// a pitch; fixed windows include the entire transient and its quiet decay.
function periodicity(samples, start = 0, end = 0.12) {
  const data = Float64Array.from({ length: Math.round((end - start) * RATE) }, (_, i) => samples[Math.round(start * RATE) + i] || 0);
  const mean = data.reduce((total, value) => total + value, 0) / data.length;
  for (let i = 0; i < data.length; i += 1) data[i] -= mean;
  const values = [];
  for (let lag = Math.ceil(RATE / 2000); lag <= Math.floor(RATE / 80); lag += 1) {
    let dot = 0; let aa = 0; let bb = 0;
    for (let i = 0; i < data.length - lag; i += 1) {
      dot += data[i] * data[i + lag]; aa += data[i] ** 2; bb += data[i + lag] ** 2;
    }
    values.push(dot / Math.sqrt(Math.max(1e-30, aa * bb)));
  }
  let peak = 0;
  for (let i = 1; i < values.length - 1; i += 1) {
    if (values[i] >= values[i - 1] && values[i] >= values[i + 1]) peak = Math.max(peak, values[i]);
  }
  return peak;
}

test('stone, ceramic and plastic defaults are short clacks followed by damped floor thuds', () => {
  for (const material of MATERIALS) for (const seed of SEEDS) {
    const options = { sampleRate: RATE, ring: 0.16, brightness: 0.5, seed };
    const contact = characterize(renderImpact(material, 1, 1, 'contact', options));
    const floor = characterize(renderImpact(material, 1, 1, 'floor', options));
    assert.ok(contact.t95 < 0.02, `${material}/${seed}: contact settles within 20 ms`);
    assert.ok(floor.t95 < 0.05 && floor.t95 > contact.t95 * 1.7, `${material}/${seed}: broader floor body`);
    assert.ok(contact.after50 < 0.005 && floor.after50 < 0.03, `${material}/${seed}: no lingering default tail`);
  }
});

test('dry and optional ringing settings retain noisy, nonperiodic impacts across seeds', () => {
  for (const material of MATERIALS) for (const type of ['contact', 'floor']) {
    for (const ring of [0, 0.16, 0.5, 1]) for (const seed of SEEDS) {
      const samples = renderImpact(material, 1, 1, type, { sampleRate: RATE, ring, seed });
      const shape = characterize(samples);
      assert.ok(shape.t95 < 0.085, `${material}/${type}/${ring}/${seed}: bounded energy decay`);
      assert.ok(shape.after100 < 0.02, `${material}/${type}/${ring}/${seed}: negligible late energy`);
      assert.ok(periodicity(samples) < 0.6, `${material}/${type}/${ring}/${seed}: noisy onset`);
      assert.ok(periodicity(samples, 0.02) < 0.6, `${material}/${type}/${ring}/${seed}: no isolated pitched tail`);
    }
  }
});

test('small dry Ring moves survive caching and adjacent sizes do not jump in register', () => {
  const messages = [];
  const audio = new DominoAudio();
  audio._armed = true;
  audio._context = { currentTime: 0, state: 'running', sampleRate: RATE };
  audio.mixer = { port: { postMessage(message) { messages.push(message); } } };
  audio.setParams({ ring: 0.03 });
  const first = audio._buffer({ material: 'plastic', height: 1 });
  audio.setParams({ ring: 0.05 });
  const second = audio._buffer({ material: 'plastic', height: 1 });
  assert.notEqual(first.bufferId, second.bufferId, 'dry Ring edits produce different cached sounds');
  const a = audio._buffer({ material: 'stone', height: 1.02 });
  const b = audio._buffer({ material: 'stone', height: 1.04 });
  assert.equal(a.bufferId, b.bufferId, 'nearby sizes share the same PCM source');
  assert.ok(a.rate > b.rate && a.rate / b.rate < 1.01, 'continuous correction makes only a small color change');
  assert.equal(messages.filter((message) => message.type === 'buffer').length, 3);
});
