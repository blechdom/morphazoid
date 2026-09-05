import assert from "node:assert/strict";
import test from "node:test";

import {
  BIRDSONG_DEMO_PRESETS,
  analysisExport,
  analyzeBirdsong,
  createDemoStrophe,
  encodeMonoWav,
  monoSamples,
  renderBirdsongModel,
} from "../src/birdsong-analysis.js";

const SAMPLE_RATE = 48_000;

function sine(frequencyHz, seconds = 0.8, amplitude = 0.7) {
  const samples = new Float32Array(Math.round(SAMPLE_RATE * seconds));
  for (let index = 0; index < samples.length; index += 1) {
    const fade = Math.min(1, index / 256, (samples.length - 1 - index) / 256);
    samples[index] = Math.sin(2 * Math.PI * frequencyHz * index / SAMPLE_RATE)
      * amplitude
      * Math.max(0, fade);
  }
  return samples;
}

function peak(samples) {
  let maximum = 0;
  for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample));
  return maximum;
}

function rms(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

test("monoSamples downmixes channels without changing their duration", () => {
  const left = new Float32Array([1, 0.5, -1]);
  const right = new Float32Array([-1, 0.5, 1]);
  assert.deepEqual(monoSamples([left, right]), new Float32Array([0, 0.5, 0]));
  assert.throws(() => monoSamples([]), /at least one channel/);
});

test("analysis finds a stable tonal fundamental and maps it to finite controls", () => {
  const analysis = analyzeBirdsong(sine(2_000), SAMPLE_RATE);
  assert.ok(analysis.voicedFraction > 0.8, `voiced fraction ${analysis.voicedFraction}`);
  assert.ok(
    Math.abs(analysis.medianF0Hz - 2_000) / 2_000 < 0.02,
    `estimated ${analysis.medianF0Hz} Hz`,
  );
  assert.equal(analysis.syllables.length, 1);
  for (const frame of analysis.frames) {
    assert.ok(Number.isFinite(frame.pressureProxy));
    assert.ok(Number.isFinite(frame.tensionProxy));
    assert.ok(frame.pressureProxy >= 0 && frame.pressureProxy <= 1);
    assert.ok(frame.tensionProxy >= 0 && frame.tensionProxy <= 1);
  }
});

test("pressure proxy follows input amplitude while pitch tension remains stable", () => {
  const samples = new Float32Array(SAMPLE_RATE);
  for (let index = 0; index < samples.length; index += 1) {
    const amplitude = index < samples.length / 2 ? 0.18 : 0.82;
    samples[index] = Math.sin(2 * Math.PI * 1_400 * index / SAMPLE_RATE) * amplitude;
  }
  const analysis = analyzeBirdsong(samples, SAMPLE_RATE);
  const first = analysis.frames.filter((frame) => frame.voiced && frame.timeSeconds < 0.4);
  const second = analysis.frames.filter((frame) => frame.voiced && frame.timeSeconds > 0.6);
  assert.ok(median(second.map((frame) => frame.pressureProxy)) > median(first.map((frame) => frame.pressureProxy)) * 1.7);
  assert.ok(Math.abs(
    median(second.map((frame) => frame.tensionProxy))
      - median(first.map((frame) => frame.tensionProxy)),
  ) < 0.03);
});

test("silence remains unvoiced and renders as silence", () => {
  const analysis = analyzeBirdsong(new Float32Array(12_000), SAMPLE_RATE);
  assert.equal(analysis.voicedFraction, 0);
  assert.equal(analysis.frames.length, 0);
  assert.match(analysis.warning, /No signal/);
  const render = renderBirdsongModel(analysis);
  assert.equal(rms(render.samples), 0);
});

test("the demo strophe analyzes into multiple syllables", () => {
  const demo = createDemoStrophe(SAMPLE_RATE);
  const analysis = analyzeBirdsong(demo.samples, demo.sampleRate);
  assert.equal(demo.expectedSyllables, 6);
  assert.ok(analysis.syllables.length >= 5, `detected ${analysis.syllables.length}`);
  assert.ok(analysis.medianF0Hz > 700 && analysis.medianF0Hz < 2_600);

  const render = renderBirdsongModel(analysis);
  const roundTrip = analyzeBirdsong(render.samples, render.sampleRate);
  assert.ok(roundTrip.syllables.length >= 5, `resynthesis retained ${roundTrip.syllables.length} syllables`);
  assert.ok(
    Math.abs(roundTrip.medianF0Hz - analysis.medianF0Hz) / analysis.medianF0Hz < 0.05,
    `round-trip median ${analysis.medianF0Hz} Hz -> ${roundTrip.medianF0Hz} Hz`,
  );
});

test("the built-in source catalog exposes three distinct synthetic phrases", () => {
  assert.equal(Object.isFrozen(BIRDSONG_DEMO_PRESETS), true);
  assert.deepEqual(
    BIRDSONG_DEMO_PRESETS.map((preset) => preset.id),
    ["mixed-songbird", "high-whistles", "low-coos"],
  );
  const ranges = {
    songbird: { minimumF0Hz: 180, maximumF0Hz: 5_500 },
    lowbird: { minimumF0Hz: 70, maximumF0Hz: 1_800 },
    ultrahigh: { minimumF0Hz: 700, maximumF0Hz: 9_000 },
  };
  const medians = [];
  for (const preset of BIRDSONG_DEMO_PRESETS) {
    assert.match(preset.label, /^Synthetic/);
    const demo = createDemoStrophe(SAMPLE_RATE, preset.id);
    const analysis = analyzeBirdsong(demo.samples, demo.sampleRate, ranges[preset.analysisRange]);
    assert.equal(demo.presetId, preset.id);
    assert.equal(analysis.syllables.length, demo.expectedSyllables);
    assert.ok(analysis.voicedFraction > 0.4);
    medians.push(analysis.medianF0Hz);
  }
  assert.ok(medians[1] > medians[0] * 2);
  assert.ok(medians[2] < medians[0] * 0.35);
});

test("physical resynthesis is deterministic, finite, bounded, and duration preserving", () => {
  const target = sine(1_350, 0.55);
  const analysis = analyzeBirdsong(target, SAMPLE_RATE);
  const first = renderBirdsongModel(analysis, { seed: 44 });
  const second = renderBirdsongModel(analysis, { seed: 44 });
  assert.equal(first.samples.length, target.length);
  assert.deepEqual(first.samples, second.samples);
  assert.ok(first.samples.every(Number.isFinite));
  assert.ok(rms(first.samples) > 0.005, `render RMS ${rms(first.samples)}`);
  assert.ok(peak(first.samples) <= 1);
});

test("pitch intervention raises the resynthesized median fundamental", () => {
  const analysis = analyzeBirdsong(sine(1_100, 0.7), SAMPLE_RATE);
  const base = renderBirdsongModel(analysis, { pitchShiftSemitones: 0, resonanceMix: 0 });
  const raised = renderBirdsongModel(analysis, { pitchShiftSemitones: 7, resonanceMix: 0 });
  const baseAnalysis = analyzeBirdsong(base.samples, SAMPLE_RATE);
  const raisedAnalysis = analyzeBirdsong(raised.samples, SAMPLE_RATE);
  assert.ok(baseAnalysis.medianF0Hz > 0);
  assert.ok(
    raisedAnalysis.medianF0Hz > baseAnalysis.medianF0Hz * 1.25,
    `${baseAnalysis.medianF0Hz} Hz -> ${raisedAnalysis.medianF0Hz} Hz`,
  );
});

test("WAV and control exports include reproducibility metadata", () => {
  const target = sine(900, 0.2);
  const analysis = analyzeBirdsong(target, SAMPLE_RATE);
  const render = renderBirdsongModel(analysis, { seed: 7 });
  const wav = encodeMonoWav(render.samples, SAMPLE_RATE);
  const header = new TextDecoder().decode(new Uint8Array(wav, 0, 12));
  assert.match(header, /^RIFF....WAVE$/s);
  assert.equal(wav.byteLength, 44 + target.length * 2);
  const exported = analysisExport(analysis, render, "fixture.wav");
  assert.equal(exported.source, "fixture.wav");
  assert.equal(exported.synthesis.seed, 7);
  assert.equal(exported.analysis.frames.length, analysis.frames.length);
  assert.match(exported.disclaimer, /not recovered physiology/);
});

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}
