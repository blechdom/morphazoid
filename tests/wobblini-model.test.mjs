import assert from "node:assert/strict";
import test from "node:test";
import { WOBBLINI_DECK_COUNT, WOBBLINI_DEMOS, createDeckState, sanitizeDeckPatch,
  sanitizeMasterPatch, crossfadeGains, deckPosition, beatLoop, createDemoSamples,
  waveformPeaks, wobbleAt, syncLoopPeriod } from "../src/instruments/wobblini/wobblini-model.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);

test("Wobblini has eight independent, initially stopped and moderately leveled decks", () => {
  assert.equal(WOBBLINI_DECK_COUNT, 8); assert.equal(WOBBLINI_DEMOS.length, 8);
  const decks = Array.from({ length: 8 }, (_, index) => createDeckState(index));
  assert.equal(new Set(decks.map(deck => deck.name)).size, 8);
  assert.ok(decks.every(deck => !deck.playing && deck.gain <= 0.7 && deck.loopEnabled && deck.loopStart === 0 && deck.loopEnd === deck.duration));
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
  assert.deepEqual(patch, { gain: 0.7, pan: -1, rate: 1.08, bpm: 120,
    eq: { low: -24, mid: 0, high: 12 }, filter: 1 });
  assert.deepEqual(sanitizeMasterPatch({ gain: NaN, crossfader: -8, wobbleRate: Infinity, wobbleAmount: 20 }),
    { gain: 0.65, crossfader: -1, wobbleRate: 2, wobbleAmount: 1 });
});

test("Wobblini audio-clock position crosses many loops without animation ticks", () => {
  const state = { ...createDeckState(0), position: 2.8, anchorTime: 5, playing: true,
    rate: 1.5, loopEnabled: true, loopStart: 2, loopEnd: 4 };
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

test("Wobblini wobble integrates a frequency ramp without phase jumps", () => {
  const clock = { time: 10, phase: 0.2, frequency: 2, targetFrequency: 6, endTime: 10.1 };
  near(wobbleAt(clock, 10).phase, 0.2);
  near(wobbleAt(clock, 10.05).phase, 0.35); near(wobbleAt(clock, 10.05).frequency, 4);
  near(wobbleAt(clock, 10.1).phase, 0.6); near(wobbleAt(clock, 10.2).phase, 0.2);
});


test("Wobblini sync math matches exact beat-offset-relative phase inside source and loop bounds", async () => {
  const { beatPhase, syncPosition, syncRate, syncLoopPeriod } = await import("../src/instruments/wobblini/wobblini-model.js");
  const master = { ...createDeckState(0), bpm: 128, rate: 1.125, beatOffset: 0.123 };
  for (const bpm of [90, 120, 180, 240]) {
    const state = { ...createDeckState(1), bpm, beatOffset: 0.213, loopEnabled: false };
    near(syncRate(state, master) * bpm, 144);
    for (const position of [0, 0.03, 1.234, 7.999]) for (const phase of [0, 0.1, 0.5, 0.999]) {
      const target = syncPosition(position, state, phase);
      assert.ok(target >= 0 && target < state.duration);
      const error = Math.abs(beatPhase(target, state) - phase);
      assert.ok(Math.min(error, 1 - error) < 1e-7);
    }
  }
  assert.equal(syncRate({ bpm: 40 }, master), null);
  assert.equal(syncRate({ bpm: 240 }, { bpm: 40, rate: 1 }), null);
  const state = { ...createDeckState(1), loopEnabled: true, loopStart: 0.1, loopEnd: 0.35 };
  assert.equal(syncLoopPeriod(state), 0.5);
  const target = syncPosition(0.11, state, 0.37, 0.5);
  near(beatPhase(target, state, 0.5), 0.37);
  assert.equal(syncLoopPeriod({ ...state, loopEnd: 0.333 }), null);
  assert.equal(syncPosition(0, { ...state, loopEnabled: false, duration: 0.03 }, 0.9), null);
});


test("Wobblini loops snap to the manually chosen cue grid and stay inside the source", () => {
  assert.deepEqual(beatLoop(1.13, 2, 120, 8, 0.2), { loopStart: 0.7, loopEnd: 1.7 });
  assert.deepEqual(beatLoop(0.1, 2, 120, 8, 0.2), { loopStart: 0, loopEnd: 1 });
  assert.deepEqual(beatLoop(7.9, 4, 120, 8, 0.2), { loopStart: 6, loopEnd: 8 });
});

test("Wobblini sync loop classification allows exactly one source frame at whole and half beats", () => {
  for (const sampleRate of [32000, 48000]) for (const bpm of [40, 120, 240]) {
    for (const beats of [0.5, 1, 1.5, 16]) for (const loopStart of [0, 120.123]) {
      const period = Number.isInteger(beats) ? 1 : 0.5, length = beats * 60 / bpm;
      for (const frames of [-1, 0, 1]) {
        const state = { ...createDeckState(0), loopEnabled: true, bpm, loopStart, loopEnd: loopStart + length + frames / sampleRate };
        assert.equal(syncLoopPeriod(state, sampleRate), period, `${sampleRate} Hz / ${bpm} BPM / ${beats} beats / ${frames} frame`);
      }
      for (const frames of [-2, -1.01, 1.01, 2]) {
        const state = { ...createDeckState(0), loopEnabled: true, bpm, loopStart, loopEnd: loopStart + length + frames / sampleRate };
        assert.equal(syncLoopPeriod(state, sampleRate), null, `${frames} frames exceed the source rounding allowance`);
      }
    }
    const tiny = { ...createDeckState(0), loopEnabled: true, bpm, loopEnd: 1 / sampleRate };
    assert.equal(syncLoopPeriod(tiny, sampleRate), null, "a positive half-beat count is required");
  }
  const short = { ...createDeckState(0), loopEnabled: true, loopEnd: 8 - 1 / 32000 };
  assert.equal(syncLoopPeriod(short), null, "unknown source rate retains the previous narrow tolerance");
  assert.equal(syncLoopPeriod(short, 32000), 1);
  assert.equal(syncLoopPeriod(short, 48000), null, "use actual source frames, not a universal time allowance");
});

test("Wobblini selected speed ranges clamp manual edits while Sync has its own bounded range", async () => {
  const { WOBBLINI_TEMPO_RANGES, tempoBounds, syncRate } = await import("../src/instruments/wobblini/wobblini-model.js");
  assert.deepEqual(WOBBLINI_TEMPO_RANGES, [8, 10, 16, 25, 50, 75]);
  for (const range of WOBBLINI_TEMPO_RANGES) {
    const state = { ...createDeckState(0), tempoRange: range }, [low, high] = tempoBounds(range);
    near(sanitizeDeckPatch({ rate: -99 }, state).rate, low); near(sanitizeDeckPatch({ rate: 99 }, state).rate, high);
  }
  near(sanitizeDeckPatch({ tempoRange: 8 }, { ...createDeckState(0), rate: 1.7 }).rate, 1.08);
  near(syncRate({ bpm: 120 }, { bpm: 120, rate: 1.75 }), 1.75);
  assert.equal(syncRate({ bpm: 120 }, { bpm: 120, rate: 1.76 }), null);
});

test("Wobblini AutoGain bounds quiet, silent, non-finite and transient-heavy audio", async () => {
  const { analyzeTrackLevel } = await import("../src/instruments/wobblini/wobblini-level-analysis.js");
  assert.equal(analyzeTrackLevel([new Float32Array(100)]).gainDb, 0);
  assert.equal(analyzeTrackLevel([[NaN, Infinity]]).gainDb, 0);
  assert.equal(analyzeTrackLevel([new Float32Array(100).fill(0.001)]).gainDb, 12);
  const spike = new Float32Array(1000); spike[2] = 1;
  near(analyzeTrackLevel([spike]).gainDb, -1);
});
