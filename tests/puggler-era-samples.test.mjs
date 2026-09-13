import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEraPhrase, renderEraDrum } from '../src/puggler-era-samples.js';

const skins = ['history', 'future'], roles = ['guitar', 'bass'], drums = ['kick', 'snare', 'crash', 'tom', 'hat'];
const rms = data => Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
const peak = data => data.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
// Coarse, level-independent spectral bands plus a sixteen-window phrase contour.
// These are objective separation checks, not an instrument-authenticity test.
function features(data, rate = 22050) {
  const cutoffs = [120, 350, 1000, 3000, Math.min(7000, rate * .43)];
  const coefficients = cutoffs.map(frequency => 1 - Math.exp(-2 * Math.PI * frequency / rate));
  const low = new Float64Array(5), energy = new Float64Array(6);
  for (const value of data) {
    let previous = 0;
    for (let i = 0; i < low.length; i++) {
      low[i] += coefficients[i] * (value - low[i]);
      energy[i] += (low[i] - previous) ** 2; previous = low[i];
    }
    energy[5] += (value - previous) ** 2;
  }
  const total = energy.reduce((sum, value) => sum + value, 0);
  const spectrum = Array.from(energy, value => Math.sqrt(value / total)), envelope = [];
  for (let i = 0; i < 16; i++) envelope.push(rms(data.subarray(Math.floor(i * data.length / 16), Math.floor((i + 1) * data.length / 16))));
  const norm = Math.hypot(...envelope);
  return { spectrum, envelope: envelope.map(value => value / norm) };
}
const phraseBank = skins.flatMap(skin => roles.flatMap(role => [0, 1, 2].map(owner => ({
  skin, role, owner, data: renderEraPhrase(skin, role, owner),
}))));
const drumBank = skins.flatMap(skin => drums.map(drum => ({ skin, drum, data: renderEraDrum(skin, drum) })));

test('every era/character/role produces a fresh deterministic two-second phrase with balanced levels', () => {
  for (const { skin, role, owner, data } of phraseBank) {
    const again = renderEraPhrase(skin, role, owner);
    assert.notEqual(data, again);
    assert.deepEqual(data, again);
    assert.equal(data.length, 44100);
    assert.ok(data.every(Number.isFinite));
    assert.ok(peak(data) <= .9);
    assert.ok(rms(data) >= .14 && rms(data) <= .2, `${skin}/${role}/${owner}`);
    assert.equal(Math.abs(data[0]), 0);
    assert.equal(Math.abs(data.at(-1)), 0);
    assert.ok(rms(data.subarray(Math.round(22050 * 1.85))) < 1e-6, 'the phrase finishes with a genuine rest');
    data[100] = 100;
    assert.deepEqual(renderEraPhrase(skin, role, owner), again, 'caller mutation cannot corrupt a later rendering');
    data[100] = again[100];
  }
});

test('character phrases differ in cadence and spectrum after level matching', () => {
  for (const role of roles) {
    const bank = phraseBank.filter(part => part.role === role);
    for (let i = 0; i < bank.length; i++) for (let j = i + 1; j < bank.length; j++) {
      const a = features(bank[i].data), b = features(bank[j].data);
      const rhythm = distance(a.envelope, b.envelope), spectrum = distance(a.spectrum, b.spectrum);
      const pair = `${role}: ${bank[i].skin}/${bank[i].owner} vs ${bank[j].skin}/${bank[j].owner}`;
      assert.ok(rhythm > .2, `${pair} has its own phrase contour`);
      assert.ok(spectrum > .003, `${pair} differs beyond volume`);
      if (bank[i].skin === bank[j].skin) assert.ok(spectrum > .025, `${pair} retains its own tone within the era`);
    }
  }
});

test('lead voices retain upper-partial identity above their matching basses', () => {
  const roughness = data => {
    let energy = 0;
    for (let i = 1; i < data.length; i++) energy += (data[i] - data[i - 1]) ** 2;
    return Math.sqrt(energy / (data.length - 1)) / rms(data);
  };
  for (const skin of skins) for (const owner of [0, 1, 2]) {
    const lead = phraseBank.find(part => part.skin === skin && part.owner === owner && part.role === 'guitar').data;
    const bass = phraseBank.find(part => part.skin === skin && part.owner === owner && part.role === 'bass').data;
    assert.ok(roughness(lead) > roughness(bass) * 1.5, `${skin}/${owner} lead is brighter than its bass`);
  }
});

test('era drum hits have finite decaying tails, useful levels and distinct era signatures', () => {
  for (const { skin, drum, data } of drumBank) {
    assert.deepEqual(data, renderEraDrum(skin, drum));
    assert.ok(data.length > 22050 * .1 && data.length <= 22050 * 1.3);
    assert.ok(data.every(Number.isFinite));
    assert.ok(peak(data) <= .9);
    assert.ok(rms(data) >= .14 && rms(data) <= .2);
    assert.equal(Math.abs(data[0]), 0);
    assert.equal(Math.abs(data.at(-1)), 0);
    assert.ok(rms(data.subarray(Math.floor(data.length * .75))) < rms(data.subarray(0, Math.floor(data.length * .25))) * .5,
      `${skin}/${drum} decays rather than sustaining a drone`);
  }
  for (const drum of drums) {
    const a = features(drumBank.find(part => part.skin === 'history' && part.drum === drum).data);
    const b = features(drumBank.find(part => part.skin === 'future' && part.drum === drum).data);
    assert.ok(distance(a.spectrum, b.spectrum) > .02, `${drum} era spectra differ after level matching`);
    assert.ok(distance(a.envelope, b.envelope) > .02, `${drum} era envelopes differ`);
  }
});

test('all banks remain finite, balanced and bounded from 8 to 96 kHz', () => {
  for (const rate of [8000, 48000, 96000]) for (const skin of skins) {
    for (const role of roles) for (const owner of [0, 1, 2]) {
      const data = renderEraPhrase(skin, role, owner, rate);
      assert.equal(data.length, rate * 2);
      assert.ok(data.every(Number.isFinite));
      assert.ok(peak(data) <= .9);
      assert.ok(rms(data) >= .14 && rms(data) <= .2);
      assert.equal(Math.abs(data[0]), 0);
      assert.equal(Math.abs(data.at(-1)), 0);
    }
    for (const drum of drums) {
      const data = renderEraDrum(skin, drum, rate);
      assert.ok(data.length <= rate * 1.3);
      assert.ok(data.every(Number.isFinite));
      assert.ok(peak(data) <= .9);
      assert.ok(rms(data) >= .14 && rms(data) <= .2);
    }
  }
});

test('invalid identities and sample-rate extremes have explicit bounded behavior', () => {
  for (const skin of ['', undefined, 'punk', '__proto__', null]) {
    assert.throws(() => renderEraPhrase(skin, 'guitar'), RangeError);
    assert.throws(() => renderEraDrum(skin, 'kick'), RangeError);
  }
  for (const role of ['', 'oi', 'woo', '__proto__', null]) assert.throws(() => renderEraPhrase('history', role), RangeError);
  for (const drum of ['', 'guitar', '__proto__', null]) assert.throws(() => renderEraDrum('future', drum), RangeError);
  for (const owner of [-1, 3, NaN, Infinity, '1', 1.5, null]) {
    assert.deepEqual(renderEraPhrase('future', 'bass', owner), renderEraPhrase('future', 'bass', 0));
  }
  assert.equal(renderEraPhrase('history', 'guitar', 0, -1).length, 16000);
  assert.equal(renderEraPhrase('history', 'guitar', 0, 1e20).length, 192000);
  assert.equal(renderEraPhrase('history', 'guitar', 0, 22050.6).length, 44102);
  for (const rate of [NaN, Infinity, -Infinity, '48000', null]) {
    assert.deepEqual(renderEraPhrase('future', 'guitar', 1, rate), renderEraPhrase('future', 'guitar', 1, 22050));
    assert.deepEqual(renderEraDrum('history', 'snare', rate), renderEraDrum('history', 'snare', 22050));
  }
});
