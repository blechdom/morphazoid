import assert from 'node:assert/strict';
import test from 'node:test';
import { expandedPythagoreanVoices, comparisonScenarios, economyVoices,
  makeInput, encodeFloatWav, decodeFloatWav, renderReference, sceneForVoices,
  differenceMetrics, signalMetrics, spectralMetrics, sha256, levelMatch, stressVoices, timingMetrics } from '../scripts/compare-l-system-delay.mjs';

test('comparison preserves actual 48/256/1022 browser scenes and reveals mutation pitch merging', () => {
  const scenarios = comparisonScenarios();
  for (const count of [48, 256, 1022]) {
    const scene = scenarios.find(row => row.name === `default-${count}-economy`).scene;
    assert.equal(scene.events[0].voices.length, count);
    assert.equal(scene.events[0].limit, count);
  }
  const ivy = scenarios.find(row => row.name === 'midnight-ivy-48-economy');
  assert.ok(ivy.pitchDetail.mergedShiftedPitches > 0);
  assert.equal(ivy.pitchDetail.exactShiftedPitches, 24);
  assert.equal(scenarios.find(row => row.name === 'default-48-economy').scene.events[0].voices.at(-1).generation, 5);
});

test('native extension covers every connected fork instead of silently retaining browser topology caps', () => {
  const voices = expandedPythagoreanVoices({ generations: 13 });
  assert.equal(voices.length, 16382);
  const ids = new Set(voices.map(voice => voice.key.replace('generation:', '')));
  assert.ok(voices.every(voice => voice.parentId === 'trunk' || ids.has(voice.parentId)));
  assert.equal(voices.filter(voice => voice.generation === 13).length, 8192);
  assert.ok(voices.every(voice => voice.rate >= .125 && voice.rate <= 8 && voice.delay <= 39));
  assert.throws(() => expandedPythagoreanVoices({ generations: 14 }), RangeError);
});

test('extension uses the same early branch timing and pitch and generation power normalization', () => {
  const voices = expandedPythagoreanVoices({ generations: 3, interval: 500, timeRatio: .5, angle: 30, depth: .8 });
  assert.equal(voices.length, 14);
  assert.deepEqual(voices.slice(0, 2).map(voice => voice.delay), [.25, .25]);
  assert.deepEqual(voices.filter(voice => voice.generation === 3).map(voice => voice.delay), Array(8).fill(.4375));
  assert.ok(Math.abs(voices[0].rate - 2 ** (-2 / 12)) < 1e-12);
  const power = voices.filter(voice => voice.generation === 3).reduce((sum, voice) => sum + voice.gain ** 2, 0);
  assert.ok(Math.abs(power - .25 * .8 ** (3 * 1.44)) < 1e-12);
});

test('common float32 input round trips and uses a deterministic quiet tail', () => {
  const mono = makeInput();
  const decoded = decodeFloatWav(encodeFloatWav(mono, 48000, 1));
  assert.deepEqual(decoded.samples, mono);
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.sampleRate, 48000);
  assert.deepEqual(makeInput(), mono);
  assert.ok(mono.slice(0, 48000).some(value => value !== 0));
  assert.ok(mono.slice(Math.ceil(1.8 * 48000)).every(value => value === 0));
  assert.throws(() => decodeFloatWav(Buffer.alloc(44)), /RIFF/);
});

test('comparison decodes extensible stereo float WAV emitted by the Rust writer', () => {
  const samples = Float32Array.of(.25, -.125, -.5, .75);
  const classic = encodeFloatWav(samples);
  const format = Buffer.alloc(48);
  classic.copy(format, 0, 12, 36);
  format.writeUInt32LE(40, 4);
  format.writeUInt16LE(0xfffe, 8);
  format.writeUInt16LE(22, 24);
  format.writeUInt16LE(32, 26);
  format.writeUInt32LE(3, 28);
  Buffer.from('0300000000001000800000aa00389b71', 'hex').copy(format, 32);
  const extended = Buffer.concat([classic.subarray(0, 12), format, classic.subarray(36)]);
  extended.writeUInt32LE(extended.length - 8, 4);
  const decoded = decodeFloatWav(extended);
  assert.equal(decoded.channels, 2);
  assert.equal(decoded.sampleRate, 48000);
  assert.deepEqual(decoded.samples, samples);
});

test('reference obeys sample-accurate retime/release events and exposes finite stereo output', () => {
  const scene = sceneForVoices([], { events: [
    { time: .05, voices: [{ key: 'a', rate: 1, delay: .01, gain: .4, pan: -.5 }], limit: 1 },
    { time: .11, voices: [], limit: 0 },
  ] });
  const input = new Float32Array(48000 / 2).fill(.2);
  const audio = renderReference(scene, input, .5);
  assert.ok(audio.slice(0, .05 * 48000 * 2).every(value => value === 0));
  assert.ok(audio.slice(.06 * 48000 * 2, .1 * 48000 * 2).some(value => value > .001));
  assert.ok(audio.slice(.35 * 48000 * 2).every(value => Math.abs(value) < .0001));
  const metrics = signalMetrics(audio);
  assert.ok(metrics.peak > 0 && metrics.peak < 1);
  assert.ok(metrics.onsetFrame >= .05 * 48000);
  assert.equal(differenceMetrics(audio, audio).exactlyEqual, true);
  assert.throws(() => differenceMetrics(audio, audio.subarray(1)), /length mismatch/);
});

test('benchmark workload contains independently shifted voices and honest block deadlines', () => {
  const voices = stressVoices(16384);
  assert.equal(voices.length, 16384);
  assert.ok(new Set(voices.map(voice => voice.rate)).size > 16000);
  assert.ok(voices.every(voice => voice.gain > 0 && voice.delay < .55));
  assert.ok(voices.every(voice => Math.abs(voice.rate - 1) >= .0005), 'stress cannot use the unison fast path');
  const metrics = timingMetrics([1, 2, 3, 4], 48000, 128);
  assert.equal(metrics.medianMs, 2);
  assert.equal(metrics.p99Ms, 4);
  assert.equal(metrics.deadlineMisses, 2);
  assert.equal(metrics.blocks, 4);
  assert.ok(Math.abs(metrics.realtimeFactor - .9375) < 1e-12);
});

test('physical listening copies match RMS and retain raw samples, with a peak ceiling', () => {
  const raw = new Float32Array([.05, -.1, .15, -.2]);
  const before = raw.slice();
  const matched = levelMatch(raw);
  assert.deepEqual(raw, before);
  assert.ok(Math.abs(matched.metrics.rms - 10 ** (-18 / 20)) < 1e-8);
  assert.ok(matched.metrics.peak <= .9);
  const transient = new Float32Array(1000); transient[0] = 1;
  assert.ok(levelMatch(transient).metrics.peak <= .900001);
  assert.ok(levelMatch(new Float32Array(8)).samples.every(value => value === 0));
});

test('fixed Hann FFT measures a 375 Hz anti-phase stereo tone without downmix cancellation', () => {
  const samples = new Float32Array(48000 * 2);
  for (let frame = 0; frame < samples.length / 2; frame++) {
    const tone = .4 * Math.sin(2 * Math.PI * 375 * frame / 48000);
    samples[frame * 2] = tone; samples[frame * 2 + 1] = -tone;
  }
  const metrics = signalMetrics(samples);
  assert.ok(Math.abs(metrics.spectral.centroidHz - 375) < .1);
  assert.ok(metrics.spectral.bandEnergyFractions.hz200to1000 > .9999);
  assert.ok(metrics.stereoCorrelation < -.9999);
  assert.ok(metrics.tailRms > .28 && metrics.tailRms < .29);
  assert.equal(metrics.clippedSamples, 0);
  assert.equal(metrics.spectral.fftFrames, 4096);
  assert.deepEqual(spectralMetrics(samples), metrics.spectral);
});

test('spectral silence is finite and clipping/nonfinite guard metrics are explicit', () => {
  const metrics = signalMetrics(new Float32Array(10000));
  assert.equal(metrics.spectral.centroidHz, 0);
  assert.deepEqual(metrics.spectral.bandEnergyFractions, { hz20to200: 0, hz200to1000: 0, hz1000to8000: 0 });
  assert.equal(metrics.tailRms, 0);
  assert.equal(metrics.onsetFrame, -1);
  assert.equal(signalMetrics(new Float32Array([1, -1])).clippedSamples, 2);
  assert.throws(() => signalMetrics(new Float32Array([NaN, 0])), /Non-finite/);
  assert.throws(() => signalMetrics(new Float32Array([1.01, 0])), /exceeds unity/);
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
