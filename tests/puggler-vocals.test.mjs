import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOCAL_CHARACTERS, vocalCharacter, renderCharacterVocal } from '../src/puggler-vocals.js';
import { renderVocalChant } from '../src/puggler-samples.js';
import { decodePcmWav } from '../src/pcm-wav-decoder.js';
import { SKINS } from '../src/puggler-skins.js';

const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / Math.max(1, data.length));
const peak = data => data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const interpolate = (data, at) => {
  if (at < 0 || at >= data.length) return 0;
  const i = Math.floor(at), fraction = at - i;
  return data[i] * (1 - fraction) + (data[i + 1] ?? 0) * fraction;
};
function correlation(a, b) {
  let aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < a.length; i++) { aa += a[i] ** 2; bb += b[i] ** 2; ab += a[i] * b[i]; }
  return ab / Math.sqrt(aa * bb);
}
const decoded = Object.fromEntries(['oi', 'woo'].map(role => [
  role, decodePcmWav(readFileSync(new URL(`../assets/puggler/${role}.wav`, import.meta.url))),
]));
const recordings = {
  oi: renderVocalChant(decoded.oi.samples, decoded.oi.sampleRate),
  woo: decoded.woo.samples,
};
const rendered = Object.fromEntries(Object.entries(recordings).map(([role, input]) => [
  role, VOCAL_CHARACTERS.map(profile => renderCharacterVocal(input, decoded[role].sampleRate, profile)),
]));

test('nine immutable character profiles resolve stable cast identities and safe fallbacks', () => {
  assert.equal(VOCAL_CHARACTERS.length, 9);
  assert.equal(new Set(VOCAL_CHARACTERS.map(profile => profile.id)).size, 9);
  assert.ok(Object.isFrozen(VOCAL_CHARACTERS));
  const names = Object.fromEntries(SKINS.map(skin => [skin.id, skin.riders]));
  for (const [skin, cast] of Object.entries(names)) for (let owner = 0; owner < 3; owner++) {
    const profile = vocalCharacter(skin, owner);
    assert.equal(profile.name, cast[owner]);
    assert.equal(profile.skin, skin);
    assert.equal(profile.owner, owner);
    assert.ok(Object.isFrozen(profile));
  }
  assert.equal(vocalCharacter(), VOCAL_CHARACTERS[0]);
  assert.equal(vocalCharacter('__proto__', 2), vocalCharacter('punk', 2));
  for (const owner of [-1, 3, Infinity, NaN, 1.1, '1', null]) {
    assert.equal(vocalCharacter('future', owner), vocalCharacter('future', 0));
  }
});

test('real recorded OI and WOO treatments retain useful levels, finite samples and clean boundaries', () => {
  for (const [role, input] of Object.entries(recordings)) {
    const before = input.slice(), levels = [];
    for (let i = 0; i < VOCAL_CHARACTERS.length; i++) {
      const profile = VOCAL_CHARACTERS[i], rate = decoded[role].sampleRate;
      const data = renderCharacterVocal(input, rate, profile);
      const speechLength = Math.ceil(input.length / 2 ** (profile.pitch / 12));
      assert.notEqual(data, input);
      assert.equal(data.length, speechLength + Math.ceil(rate * .09));
      assert.ok(data.every(Number.isFinite), `${role}/${profile.name}`);
      assert.ok(peak(data) <= .881);
      assert.ok(rms(data) > rms(input) * .5, `${role}/${profile.name} retains useful output level`);
      assert.ok(rms(data) <= rms(input) * 1.01, 'processing never boosts RMS beyond the source');
      assert.equal(Math.abs(data[0]), 0);
      assert.equal(Math.abs(data.at(-1)), 0);
      assert.ok(rms(data.subarray(-Math.round(rate * .005))) < .0001, 'tail settles before the boundary');
      levels.push(rms(data));
    }
    assert.ok(Math.max(...levels) / Math.min(...levels) < 1.6, `${role} character RMS spread stays below 4.1 dB`);
    assert.deepEqual(input, before);
  }
});

test('every voice differs after level matching and compensating its pitch/duration shift', () => {
  for (const [role, input] of Object.entries(recordings)) {
    // Undo the gross playback-duration change for comparison. Correlation is
    // gain-independent, so volume or the assigned pitch alone cannot pass this.
    const aligned = rendered[role].map((data, n) => Float32Array.from(input, (_, i) =>
      interpolate(data, i / 2 ** (VOCAL_CHARACTERS[n].pitch / 12))));
    for (let i = 0; i < aligned.length; i++) for (let j = i + 1; j < aligned.length; j++) {
      const score = correlation(aligned[i], aligned[j]);
      assert.ok(score < .995, `${role}: ${VOCAL_CHARACTERS[i].name}/${VOCAL_CHARACTERS[j].name} correlation ${score}`);
    }
  }
});

test('all three recorded OI syllables survive each pitch shift with a pause between calls', () => {
  const rate = decoded.oi.sampleRate;
  for (const [index, profile] of VOCAL_CHARACTERS.entries()) {
    const data = rendered.oi[index], ratio = 2 ** (profile.pitch / 12);
    const energy = [];
    for (let call = 0; call < 3; call++) {
      const start = Math.round(call * .6 * rate / ratio), end = Math.round((call * .6 + .45) * rate / ratio);
      const syllable = rms(data.subarray(start, end));
      assert.ok(syllable > .08, `${profile.name} call ${call + 1}`);
      energy.push(syllable);
      if (call < 2) {
        const pause = data.subarray(Math.round((call * .6 + .52) * rate / ratio), Math.round((call * .6 + .59) * rate / ratio));
        assert.ok(rms(pause) < syllable * .12, `${profile.name} keeps the syllable gap`);
      }
    }
    assert.ok(Math.min(...energy) / Math.max(...energy) > .65, `${profile.name} keeps every call audible`);
  }
});

test('the pitch centers move a calibration tone in the declared direction at musician sample rates', () => {
  for (const rate of [8000, 22050, 48000, 96000, 192000]) {
    const input = Float32Array.from({ length: Math.round(rate * .2) }, (_, i) => .2 * Math.sin(2 * Math.PI * 300 * i / rate));
    for (const profile of VOCAL_CHARACTERS) {
      const data = renderCharacterVocal(input, rate, { ...profile, doubleMix: 0, ringMix: 0, cadenceDepth: 0 });
      const start = Math.round(rate * .03), end = Math.min(data.length, Math.round(input.length / 2 ** (profile.pitch / 12) - rate * .015));
      let crossings = 0;
      for (let i = start + 1; i < end; i++) if (data[i - 1] <= 0 && data[i] > 0) crossings++;
      const measured = crossings * rate / (end - start), expected = 300 * 2 ** (profile.pitch / 12);
      assert.ok(Math.abs(measured / expected - 1) < .06, `${profile.name}/${rate}: ${measured} vs ${expected}`);
    }
  }
});

test('hostile inputs remain bounded without mutating source or allocating unbounded tails', () => {
  for (const value of [undefined, null, [], new Float64Array(2), new ArrayBuffer(4)]) {
    assert.throws(() => renderCharacterVocal(value, 22050), TypeError);
  }
  for (const rate of [undefined, 0, -1, 7999, 192001, NaN, Infinity, '22050']) {
    assert.throws(() => renderCharacterVocal(new Float32Array(4), rate), RangeError);
  }
  assert.throws(() => renderCharacterVocal(new Float32Array(8000 * 8 + 1), 8000), RangeError);
  assert.deepEqual(renderCharacterVocal(new Float32Array(), 22050), new Float32Array());
  const corrupt = new Float32Array([Infinity, NaN, -Infinity, 100, -100, .5, -.5]);
  const before = corrupt.slice();
  for (const profile of [null, false, {}, { pitch: -Infinity, colorHz: NaN }, {
    pitch: -999, highpass: -999, lowpass: Infinity, colorHz: 999999, colorQ: 999, colorDb: 999,
    edgeHz: -999, edgeDb: -999, doubleMs: 999, doubleMix: 999, chorusMs: 999,
    chorusHz: 999, ringHz: 999, ringMix: 999, cadenceHz: 999, cadenceDepth: 999,
  }]) {
    const data = renderCharacterVocal(corrupt, 8000, profile);
    assert.ok(data.length <= corrupt.length * 2 + 8000 * .091);
    assert.ok(data.every(Number.isFinite));
    assert.ok(peak(data) <= .881);
    assert.equal(Math.abs(data[0]), 0);
    assert.equal(Math.abs(data.at(-1)), 0);
  }
  assert.deepEqual(corrupt, before);
  for (const profile of VOCAL_CHARACTERS) {
    assert.equal(peak(renderCharacterVocal(new Float32Array(8000), 8000, profile)), 0);
  }
  assert.deepEqual(renderCharacterVocal(recordings.oi, 22050), rendered.oi[0], 'rendering is deterministic');
});
