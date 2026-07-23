import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_THROATS,
  SPECIMENS,
  anatomyLayout,
  glottalCoefficients,
  glottalHarmonics,
  glottalSample,
  smoothEnvelope,
  specimenState,
  throatSlots,
  throatVoiceParameters,
  waveformLevel,
} from "../src/throatazoid.js";

test("Throatazoid specimens produce complete bounded anatomy", () => {
  assert.equal(MAX_THROATS, 5);
  assert.deepEqual(Object.keys(SPECIMENS), [
    "triune",
    "oracle",
    "hive",
    "razor",
    "monolith",
    "siren",
    "larva",
    "cathedral",
    "needle",
    "maw",
    "choir",
    "void",
  ]);

  for (const name of Object.keys(SPECIMENS)) {
    const state = specimenState(name);
    assert.equal(state.throats.length, MAX_THROATS);
    assert.ok(state.throatCount >= 1 && state.throatCount <= MAX_THROATS);
    assert.ok(Number.isFinite(state.exciterPitch) && state.exciterPitch > 0);
    for (const parameter of [
      "exciterIntensity",
      "exciterTenseness",
      "exciterBreath",
      "exciterVibrato",
      "exciterWobble",
      "wet",
      "dry",
      "spread",
    ]) {
      assert.ok(
        Number.isFinite(state[parameter]) && state[parameter] >= 0 && state[parameter] <= 1,
        `${name}.${parameter} must be a finite unit value`,
      );
    }
    const layout = anatomyLayout(960, 620, state);
    assert.equal(layout.branches.length, state.throatCount);
    assert.ok(layout.root.x < layout.junction.x);

    for (const branch of layout.branches) {
      assert.equal(branch.polygon.length, 6);
      assert.ok(branch.mouth.x > layout.junction.x);
      assert.ok(branch.handle.x > layout.junction.x);
      assert.ok(branch.handle.x < 960);
      assert.ok(branch.handle.y > 0 && branch.handle.y < 620);
    }
  }

  const states = Object.keys(SPECIMENS).map((name) => specimenState(name));
  const fingerprints = states.map((state) => JSON.stringify({
    throatCount: state.throatCount,
    bodyLength: state.bodyLength,
    tension: state.tension,
    mutation: state.mutation,
    coupling: state.coupling,
    growl: state.growl,
    wet: state.wet,
    dry: state.dry,
    spread: state.spread,
    exciterPitch: state.exciterPitch,
    exciterIntensity: state.exciterIntensity,
    exciterTenseness: state.exciterTenseness,
    exciterBreath: state.exciterBreath,
    exciterVibrato: state.exciterVibrato,
    exciterWobble: state.exciterWobble,
    throats: state.throats.slice(0, state.throatCount),
  }));
  assert.equal(new Set(fingerprints).size, 12, "every specimen needs a distinct full voice");
  assert.deepEqual(
    [...new Set(states.map((state) => state.throatCount))].sort(),
    [1, 2, 3, 4, 5],
  );
  assert.ok(Math.max(...states.map((state) => state.exciterPitch)) >= 300);
  assert.ok(Math.min(...states.map((state) => state.exciterPitch)) <= 50);
  assert.ok(Math.max(...states.map((state) => state.exciterBreath)) >= 0.8);
});

test("glottal coefficients and samples stay finite while tenseness changes the waveform", () => {
  const tensions = [0, 0.5, 1];
  const coefficientSets = tensions.map((tenseness) => glottalCoefficients(tenseness));

  for (const coefficients of coefficientSets) {
    assert.ok(Object.values(coefficients).every(Number.isFinite));
    assert.ok(coefficients.te > 0 && coefficients.te < 1);
    assert.ok(coefficients.delta > 0);
  }
  assert.ok(coefficientSets[0].te > coefficientSets[1].te);
  assert.ok(coefficientSets[1].te > coefficientSets[2].te);

  const phases = Array.from({ length: 128 }, (_, index) => index / 128);
  const breathy = phases.map((phase) => glottalSample(phase, 0));
  const pressed = phases.map((phase) => glottalSample(phase, 1));
  assert.ok(breathy.every(Number.isFinite));
  assert.ok(pressed.every(Number.isFinite));
  assert.ok(new Set(breathy.map((sample) => sample.toFixed(6))).size > 64);
  assert.notDeepEqual(breathy, pressed);
  assert.ok(Math.max(...breathy) > 0 && Math.min(...breathy) < 0);
  assert.ok(Math.max(...pressed) > 0 && Math.min(...pressed) < 0);
  assert.ok(Math.abs(glottalSample(-0.25, 0.6) - glottalSample(0.75, 0.6)) < 1e-12);
});

test("glottal harmonics are finite, bounded in size, and vary with tenseness", () => {
  const breathy = glottalHarmonics(0.1, 24, 256);
  const pressed = glottalHarmonics(0.9, 24, 256);

  for (const spectrum of [breathy, pressed]) {
    assert.equal(spectrum.real.length, 25);
    assert.equal(spectrum.imaginary.length, 25);
    assert.ok(Array.from(spectrum.real).every(Number.isFinite));
    assert.ok(Array.from(spectrum.imaginary).every(Number.isFinite));
    assert.equal(spectrum.real[0], 0);
    assert.equal(spectrum.imaginary[0], 0);
    const energy = Array.from(
      spectrum.real,
      (real, index) => real ** 2 + spectrum.imaginary[index] ** 2,
    ).reduce((sum, value) => sum + value, 0);
    assert.ok(energy > 0.01);
  }

  assert.notDeepEqual(Array.from(breathy.real), Array.from(pressed.real));
  assert.notDeepEqual(Array.from(breathy.imaginary), Array.from(pressed.imaginary));
});

test("input envelope smoothing follows attacks faster than releases", () => {
  assert.equal(smoothEnvelope(0.25, 0.75, 0), 0.25);
  const attacked = smoothEnvelope(0, 1, 80, 45, 360);
  const released = smoothEnvelope(1, 0, 80, 45, 360);
  assert.ok(Number.isFinite(attacked) && attacked > 0 && attacked < 1);
  assert.ok(Number.isFinite(released) && released > 0 && released < 1);
  assert.ok(attacked > 1 - released, "attack should traverse more of the gap than release");
  assert.ok(smoothEnvelope(-1, Number.NaN, 16) >= 0);
});

test("throat slots are centered, ordered, and span alien branch space", () => {
  assert.deepEqual(throatSlots(1), [0]);
  for (let count = 2; count <= MAX_THROATS; count += 1) {
    const slots = throatSlots(count);
    assert.equal(slots.length, count);
    assert.ok(slots[0] < 0);
    assert.ok(slots.at(-1) > 0);
    assert.ok(Math.abs(slots[0] + slots.at(-1)) < 1e-9);
    for (let index = 1; index < slots.length; index += 1) {
      assert.ok(slots[index] > slots[index - 1]);
    }
  }
});

test("geometry maps every throat to safe real-time formant parameters", () => {
  const state = specimenState("hive");
  const voices = Array.from(
    { length: state.throatCount },
    (_, index) => throatVoiceParameters(state, index, 48_000),
  );

  for (const voice of voices) {
    assert.equal(voice.formants.length, 4);
    for (const frequency of voice.formants) {
      assert.ok(frequency >= 80 && frequency <= 21_600);
    }
    assert.ok(voice.highpass >= 48);
    assert.ok(voice.lowpass <= 21_600);
    assert.ok(voice.resonance > 2);
    assert.ok(voice.ringMix >= 0 && voice.ringMix < 1);
    assert.ok(voice.gain > 0 && voice.gain <= 1);
    assert.ok(voice.pan >= -1 && voice.pan <= 1);
  }

  assert.equal(voices[0].pan, -1);
  assert.equal(voices.at(-1).pan, 1);
  assert.ok(voices.every((voice) => Math.abs(voice.gain - 1 / Math.sqrt(5)) < 1e-9));

  state.throats[2].muted = true;
  assert.equal(throatVoiceParameters(state, 2).gain, 0);
});

test("longer bodies and local throats lower the primary resonances", () => {
  const short = specimenState("triune");
  short.bodyLength = 0.1;
  short.throats[0].length = 0.1;
  const long = specimenState("triune");
  long.bodyLength = 0.9;
  long.throats[0].length = 0.9;

  const shortVoice = throatVoiceParameters(short, 0);
  const longVoice = throatVoiceParameters(long, 0);
  assert.ok(longVoice.formants[0] < shortVoice.formants[0]);
  assert.ok(longVoice.formants[1] < shortVoice.formants[1]);
});

test("waveform analysis reports RMS and peak without leaking invalid input", () => {
  assert.deepEqual(waveformLevel(new Float32Array()), { rms: 0, peak: 0 });
  const measured = waveformLevel(Float32Array.from([0.5, -0.5, 0.5, -0.5]));
  assert.ok(Math.abs(measured.rms - 0.5) < 1e-9);
  assert.equal(measured.peak, 0.5);
});
