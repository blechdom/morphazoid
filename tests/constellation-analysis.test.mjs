import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateFftBands,
  amplitudeToDecibels,
  frequencyToMidiNote,
  frequencyToMidiPitch,
  frequencyToNormalized,
  limitMidiCc,
  midiNoteToFrequency,
  normalizeAmplitudeDb,
  normalizeDecibels,
  normalizedToFrequency,
  normalizedToMidi7,
  smoothAttackRelease,
  updateAmplitudeGate,
  waveformRmsPeak,
} from "../src/constellation-analysis.js";

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test("MIDI note and frequency conversion are inverse for integer and fractional notes", () => {
  assert.equal(midiNoteToFrequency(69), 440);
  closeTo(midiNoteToFrequency(60), 261.6255653005986);
  for (const note of [0, 36, 60, 69.25, 127]) {
    closeTo(frequencyToMidiNote(midiNoteToFrequency(note)), note, 1e-10);
  }
  assert.equal(frequencyToMidiNote(0), null);
  assert.equal(frequencyToMidiNote(Number.NaN), null);
});

test("frequency-to-MIDI pitch reports nearest note, cents, and clipping", () => {
  const twentyFiveCentsSharp = 440 * (2 ** (25 / 1_200));
  const pitch = frequencyToMidiPitch(twentyFiveCentsSharp);
  assert.equal(pitch.note, 69);
  closeTo(pitch.exactNote, 69.25, 1e-10);
  closeTo(pitch.cents, 25, 1e-8);
  assert.equal(pitch.clamped, false);

  const clipped = frequencyToMidiPitch(1, { minNote: 24, maxNote: 96 });
  assert.equal(clipped.note, 24);
  assert.equal(clipped.cents, 0);
  assert.equal(clipped.clamped, true);
  assert.equal(frequencyToMidiPitch(-1), null);
});

test("normalized frequency mapping is exponential and round-trips", () => {
  const options = { minHz: 20, maxHz: 20_000 };
  assert.equal(normalizedToFrequency(0, options), 20);
  closeTo(normalizedToFrequency(0.5, options), Math.sqrt(20 * 20_000));
  assert.equal(normalizedToFrequency(1, options), 20_000);
  assert.equal(normalizedToFrequency(2, options), 20_000);
  for (const normalized of [0, 0.125, 0.5, 0.875, 1]) {
    closeTo(
      frequencyToNormalized(normalizedToFrequency(normalized, options), options),
      normalized,
    );
  }
  assert.equal(frequencyToNormalized(1, options), 0);
  assert.equal(frequencyToNormalized(40_000, options), 1);
});

test("linear amplitude maps through finite decibels into normalized control space", () => {
  const range = { floorDb: -60, ceilingDb: 0 };
  assert.equal(amplitudeToDecibels(1, range), 0);
  closeTo(amplitudeToDecibels(0.1, range), -20);
  assert.equal(amplitudeToDecibels(0, range), -60);
  assert.equal(normalizeDecibels(-60, range), 0);
  assert.equal(normalizeDecibels(0, range), 1);
  closeTo(normalizeAmplitudeDb(0.1, range), 2 / 3);
  assert.equal(normalizeAmplitudeDb(4, range), 1);
});

test("waveform RMS and peak extraction tolerates silence and non-finite samples", () => {
  assert.deepEqual(waveformRmsPeak(new Float32Array()), { rms: 0, peak: 0 });
  assert.deepEqual(
    waveformRmsPeak(Float32Array.from([0.5, -0.5, 0.5, -0.5])),
    { rms: 0.5, peak: 0.5 },
  );
  const mixed = waveformRmsPeak([1, Number.NaN, -1, Number.POSITIVE_INFINITY]);
  closeTo(mixed.rms, Math.sqrt(0.5));
  assert.equal(mixed.peak, 1);
});

test("FFT bands aggregate linear bins by RMS rather than selecting one peak", () => {
  const bands = aggregateFftBands(Float32Array.from([0, 1, 0.5, 0.25]), {
    sampleRate: 8_000,
    fftSize: 8,
    scale: "linear",
    floorDb: -90,
    ceilingDb: 0,
    bands: [
      { id: "low", label: "Low", minHz: 0, maxHz: 1_500 },
      { id: "high", label: "High", minHz: 1_500, maxHz: 4_000 },
    ],
  });

  assert.equal(bands.length, 2);
  assert.deepEqual(
    bands.map(({ id, firstBin, endBin, binCount }) => ({ id, firstBin, endBin, binCount })),
    [
      { id: "low", firstBin: 0, endBin: 2, binCount: 2 },
      { id: "high", firstBin: 2, endBin: 4, binCount: 2 },
    ],
  );
  closeTo(bands[0].rms, Math.sqrt(0.5));
  assert.equal(bands[0].peak, 1);
  closeTo(bands[1].rms, Math.sqrt((0.5 ** 2 + 0.25 ** 2) / 2));
  assert.equal(bands[1].peak, 0.5);
});

test("FFT decibel bins are converted to linear energy before aggregation", () => {
  const [band] = aggregateFftBands(Float32Array.from([-20, -20]), {
    sampleRate: 4_000,
    fftSize: 4,
    floorDb: -60,
    bands: [{ id: "all", minHz: 0, maxHz: 2_000 }],
  });
  closeTo(band.rms, 0.1, 1e-8);
  closeTo(band.decibels, -20, 1e-6);
  closeTo(band.normalized, 2 / 3, 1e-6);
});

test("attack and release smoothing use their independent time constants", () => {
  closeTo(smoothAttackRelease(0, 1, 10, { attackMs: 10 }), 1 - Math.exp(-1));
  closeTo(smoothAttackRelease(1, 0, 100, { releaseMs: 100 }), Math.exp(-1));
  assert.equal(smoothAttackRelease(0.3, 0.9, 0), 0.3);
  assert.equal(smoothAttackRelease(0, 1, 10, { attackMs: 0 }), 1);
});

test("amplitude gate hysteresis avoids chatter between open and close thresholds", () => {
  let gate = updateAmplitudeGate(false, 0.09, {
    openThreshold: 0.1,
    closeThreshold: 0.05,
  });
  assert.deepEqual({ open: gate.open, changed: gate.changed, action: gate.action }, {
    open: false,
    changed: false,
    action: null,
  });
  gate = updateAmplitudeGate(gate.open, 0.1, {
    openThreshold: 0.1,
    closeThreshold: 0.05,
  });
  assert.equal(gate.open, true);
  assert.equal(gate.action, "open");
  gate = updateAmplitudeGate(gate.open, 0.06, {
    openThreshold: 0.1,
    closeThreshold: 0.05,
  });
  assert.equal(gate.open, true);
  assert.equal(gate.changed, false);
  gate = updateAmplitudeGate(gate.open, 0.05, {
    openThreshold: 0.1,
    closeThreshold: 0.05,
  });
  assert.equal(gate.open, false);
  assert.equal(gate.action, "close");
});

test("MIDI CC limiter quantizes, deduplicates, and retains pending changes", () => {
  assert.equal(normalizedToMidi7(0.5), 64);
  assert.equal(normalizedToMidi7(-1), 0);
  assert.equal(normalizedToMidi7(2), 127);

  let result = limitMidiCc(null, 0.5, 0, { minimumIntervalMs: 30 });
  assert.equal(result.emit, true);
  assert.equal(result.value, 64);

  result = limitMidiCc(result.state, 0.5, 10, { minimumIntervalMs: 30 });
  assert.equal(result.emit, false);
  assert.equal(result.deduped, true);

  result = limitMidiCc(result.state, 0.75, 20, { minimumIntervalMs: 30 });
  assert.equal(result.emit, false);
  assert.equal(result.rateLimited, true);
  assert.equal(result.state.pendingValue, 95);

  result = limitMidiCc(result.state, 0.75, 30, { minimumIntervalMs: 30 });
  assert.equal(result.emit, true);
  assert.equal(result.value, 95);
  assert.equal(result.state.pendingValue, null);

  result = limitMidiCc(result.state, 0.25, 5, { minimumIntervalMs: 30 });
  assert.equal(result.emit, true, "a backwards clock resets rate limiting");
  assert.equal(result.value, 32);
});
