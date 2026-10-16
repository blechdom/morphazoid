import assert from "node:assert/strict";
import test from "node:test";
import { WOBBLINI_DECK_COUNT, WOBBLINI_DEMOS, createDeckState, sanitizeDeckPatch,
  sanitizeMasterPatch, crossfadeGains, deckPosition, beatLoop, createDemoSamples,
  waveformPeaks } from "../src/instruments/wobblini/wobblini-model.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);

test("Wobblini has eight independent, initially stopped and moderately leveled decks", () => {
  assert.equal(WOBBLINI_DECK_COUNT, 8); assert.equal(WOBBLINI_DEMOS.length, 8);
  const decks = Array.from({ length: 8 }, (_, index) => createDeckState(index));
  assert.equal(new Set(decks.map(deck => deck.name)).size, 8);
  assert.ok(decks.every(deck => !deck.playing && deck.gain <= 0.7 && deck.loopEnabled));
  decks[0].eq.low = -20; assert.equal(decks[1].eq.low, 0);
  assert.throws(() => createDeckState(8), RangeError);
});

test("Wobblini crossfade conserves equal power and leaves THRU independent", () => {
  for (const value of [-1, -0.5, 0, 0.5, 1]) {
    const gains = crossfadeGains(value); near(gains.A ** 2 + gains.B ** 2, 1); assert.equal(gains.THRU, 1);
  }
  assert.equal(crossfadeGains(-1).B, 0); assert.equal(crossfadeGains(1).A, 0);
  assert.ok(Object.values(crossfadeGains(NaN)).every(Number.isFinite));
});

test("Wobblini hostile patches stay finite and cannot overwrite live clocks or buffers", () => {
  const current = createDeckState(0);
  const patch = sanitizeDeckPatch({ gain: Infinity, pan: -99, rate: 99, bpm: NaN,
    eq: { low: -99, high: 99, mid: NaN }, playing: true, position: 999,
    assignment: "injected", mute: "false", filter: 8 }, current);
  assert.deepEqual(patch, { gain: 0.7, pan: -1, rate: 2, bpm: 120,
    eq: { low: -24, mid: 0, high: 12 }, filter: 1 });
  assert.deepEqual(sanitizeMasterPatch({ gain: NaN, crossfader: -8, wobbleRate: Infinity, wobbleAmount: 20 }),
    { gain: 0.65, crossfader: -1, wobbleRate: 2, wobbleAmount: 1 });
});

test("Wobblini audio-clock position crosses many loops without animation ticks", () => {
  const state = { ...createDeckState(0), position: 2.8, anchorTime: 5, playing: true,
    rate: 1.5, loopStart: 2, loopEnd: 4 };
  near(deckPosition(state, 5.8), 2); near(deckPosition(state, 105), 2.8);
  near(deckPosition({ ...state, playing: false }, 105), 2.8);
  near(deckPosition({ ...state, loopEnabled: false }, 105), 8);
  assert.deepEqual(beatLoop(2.31, 4, 120, 8), { loopStart: 2, loopEnd: 4 });
  assert.deepEqual(beatLoop(7.9, 32, 120, 8), { loopStart: 0, loopEnd: 8 });
});

test("Wobblini procedural demos are deterministic, distinct, audible and bounded", () => {
  const fingerprints = [];
  for (let id = 0; id < 8; id++) {
    const { samples, duration, sampleRate } = createDemoSamples(id, 8000);
    assert.equal(duration, 8); assert.equal(samples.length, duration * sampleRate);
    let energy = 0, peak = 0;
    for (const value of samples) { assert.ok(Number.isFinite(value)); energy += value * value; peak = Math.max(peak, Math.abs(value)); }
    assert.ok(Math.sqrt(energy / samples.length) > 0.005, `demo ${id} is audible`);
    assert.ok(peak < 1, `demo ${id} is bounded`);
    assert.equal(Math.abs(samples[0]), 0); assert.ok(Math.abs(samples.at(-1)) < 0.02);
    const peaks = waveformPeaks([samples]); assert.equal(peaks.length, 256);
    fingerprints.push(Array.from(peaks.slice(0, 32)).join(","));
    assert.deepEqual(samples, createDemoSamples(id, 8000).samples);
  }
  assert.equal(new Set(fingerprints).size, 8);
});

test("Wobblini waveform bins retain transients from either stereo channel", () => {
  assert.deepEqual(Array.from(waveformPeaks([new Float32Array([0, 0.8, 0, NaN]), new Float32Array([0, 0, -0.9, Infinity])], 2)),
    [Math.fround(0.8), Math.fround(0.9)]);
});
