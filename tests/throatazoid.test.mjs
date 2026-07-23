import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_THROATS,
  SPECIMENS,
  anatomyLayout,
  specimenState,
  throatSlots,
  throatVoiceParameters,
  waveformLevel,
} from "../src/throatazoid.js";

test("Throatazoid specimens produce complete bounded anatomy", () => {
  assert.equal(MAX_THROATS, 5);
  assert.deepEqual(Object.keys(SPECIMENS), ["triune", "oracle", "hive", "razor"]);

  for (const name of Object.keys(SPECIMENS)) {
    const state = specimenState(name);
    assert.equal(state.throats.length, MAX_THROATS);
    assert.ok(state.throatCount >= 1 && state.throatCount <= MAX_THROATS);
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
