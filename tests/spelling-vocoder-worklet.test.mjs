import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  SPELLING_DIPHONE_ATLAS_URL,
  SPELLING_DIPHONE_CLIPS,
} from "../src/spelling-diphone-atlas.js";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const WORKLET_URL = new URL(
  "../src/spelling-vocoder-processor.js",
  import.meta.url,
);
const WORKLET_SOURCE = readFileSync(WORKLET_URL, "utf8");

class MockAudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      postMessage() {},
    };
  }
}

function loadWorklet() {
  const registrations = new Map();
  const evaluate = vm.compileFunction(
    WORKLET_SOURCE,
    ["AudioWorkletProcessor", "registerProcessor", "sampleRate"],
    { filename: WORKLET_URL.pathname },
  );
  evaluate(
    MockAudioWorkletProcessor,
    (name, Processor) => registrations.set(name, Processor),
    SAMPLE_RATE,
  );
  return registrations;
}

function processSamples(processor, samples) {
  const output = new Float32Array(samples.length);
  for (let offset = 0; offset < samples.length; offset += BLOCK_SIZE) {
    const input = new Float32Array(BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    input.set(samples.subarray(offset, offset + BLOCK_SIZE));
    assert.equal(processor.process([[input]], [[left, right]]), true);
    const count = Math.min(BLOCK_SIZE, samples.length - offset);
    for (let frame = 0; frame < count; frame += 1) {
      assert.ok(Number.isFinite(left[frame]), "the left output must stay finite");
      assert.equal(right[frame], left[frame], "the mono vocoder output must be stereo-identical");
      assert.ok(Math.abs(left[frame]) <= 1, "the soft limiter must bound every sample");
      output[offset + frame] = left[frame];
    }
  }
  return output;
}

function signalMetrics(samples) {
  let peak = 0;
  let squareSum = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    squareSum += sample * sample;
  }
  return {
    peak,
    rms: Math.sqrt(squareSum / Math.max(1, samples.length)),
  };
}

function syntheticModulator(frameCount = BLOCK_SIZE * 96) {
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < samples.length; frame += 1) {
    const seconds = frame / SAMPLE_RATE;
    const phraseEnvelope = frame % 3_200 < 2_520 ? 1 : 0.08;
    const consonantBurst = frame % 1_180 < 92
      ? Math.sin(frame * 12.9898) * 0.22
      : 0;
    samples[frame] = phraseEnvelope * (
      Math.sin(2 * Math.PI * 137 * seconds) * 0.34
      + Math.sin(2 * Math.PI * 719 * seconds + 0.3) * 0.23
      + Math.sin(2 * Math.PI * 2_941 * seconds + 1.2) * 0.16
      + consonantBurst
    );
  }
  return samples;
}

function decodePcm16Mono(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...bytes.subarray(8, 12)), "WAVE");
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let format = 0;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      format = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataLength = length;
      break;
    }
    offset += 8 + length + (length & 1);
  }
  assert.equal(format, 1, "the atlas fixture must be linear PCM");
  assert.equal(channels, 1, "the atlas fixture must be mono");
  assert.equal(bitsPerSample, 16, "the atlas fixture must be 16-bit");
  assert.ok(dataOffset >= 0, "the atlas fixture must contain a data chunk");
  const samples = new Float32Array(dataLength / 2);
  for (let frame = 0; frame < samples.length; frame += 1) {
    samples[frame] = view.getInt16(dataOffset + frame * 2, true) / 32_768;
  }
  return { sampleRate, samples };
}

const ATLAS_AUDIO = decodePcm16Mono(readFileSync(SPELLING_DIPHONE_ATLAS_URL));

function resampledAtlasClip(key, tailSeconds = 0.075) {
  const clip = SPELLING_DIPHONE_CLIPS[key];
  assert.ok(clip, `the atlas must contain ${key}`);
  const sourceStart = Math.round(clip.offset * ATLAS_AUDIO.sampleRate);
  const sourceLength = Math.max(2, Math.round(clip.duration * ATLAS_AUDIO.sampleRate));
  const soundingFrames = Math.round(clip.duration * SAMPLE_RATE);
  const totalFrames = Math.ceil(
    (soundingFrames + tailSeconds * SAMPLE_RATE) / BLOCK_SIZE,
  ) * BLOCK_SIZE;
  const output = new Float32Array(totalFrames);
  for (let frame = 0; frame < soundingFrames; frame += 1) {
    const sourcePosition = frame * ATLAS_AUDIO.sampleRate / SAMPLE_RATE;
    const sourceFrame = Math.min(sourceLength - 2, Math.floor(sourcePosition));
    const fraction = sourcePosition - sourceFrame;
    const first = ATLAS_AUDIO.samples[sourceStart + sourceFrame];
    const second = ATLAS_AUDIO.samples[sourceStart + sourceFrame + 1];
    output[frame] = (first + (second - first) * fraction) * clip.gain;
  }
  return output;
}

function bankRms(samples, processor) {
  return Array.from(processor.bandCenters, (_, band) => {
    let z1 = 0;
    let z2 = 0;
    let squareSum = 0;
    for (const input of samples) {
      const filtered = processor.b0[band] * input + z1;
      z1 = processor.b1[band] * input
        - processor.a1[band] * filtered
        + z2;
      z2 = processor.b2[band] * input - processor.a2[band] * filtered;
      squareSum += filtered * filtered;
    }
    return Math.sqrt(squareSum / Math.max(1, samples.length));
  });
}

function logCorrelation(reference, candidate) {
  const floor = Math.max(...reference) * 0.006;
  const indices = reference
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value >= floor)
    .map(({ index }) => index);
  assert.ok(indices.length >= 5, "the clip must occupy enough analysis bands");
  let referenceMean = 0;
  let candidateMean = 0;
  for (const index of indices) {
    referenceMean += Math.log(reference[index] + 1e-12);
    candidateMean += Math.log(candidate[index] + 1e-12);
  }
  referenceMean /= indices.length;
  candidateMean /= indices.length;
  let covariance = 0;
  let referenceVariance = 0;
  let candidateVariance = 0;
  for (const index of indices) {
    const referenceValue = Math.log(reference[index] + 1e-12) - referenceMean;
    const candidateValue = Math.log(candidate[index] + 1e-12) - candidateMean;
    covariance += referenceValue * candidateValue;
    referenceVariance += referenceValue * referenceValue;
    candidateVariance += candidateValue * candidateValue;
  }
  return covariance / Math.sqrt(referenceVariance * candidateVariance);
}

function lowBandShare(bands) {
  const energies = bands.map((value) => value * value);
  const total = energies.reduce((sum, value) => sum + value, 0);
  return energies.slice(0, 4).reduce((sum, value) => sum + value, 0) / total;
}

test("the spelling vocoder registers a calibrated twenty-band ERB processor", () => {
  const registrations = loadWorklet();
  assert.deepEqual([...registrations.keys()], ["spelling-vocoder"]);
  const Processor = registrations.get("spelling-vocoder");
  assert.equal(typeof Processor, "function");
  const processor = new Processor();
  assert.equal(processor.bandCenters.length, 20);
  assert.ok(Math.abs(processor.bandCenters[0] - 120) < 0.1);
  assert.ok(Math.abs(processor.bandCenters.at(-1) - 7_600) < 0.1);
  assert.ok(
    processor.bandCenters[5] < 600 && processor.bandCenters[10] < 1_600,
    "ERB spacing must devote useful resolution to English vowel formants",
  );
  assert.ok(processor.noiseBandGains.every((gain) => Number.isFinite(gain) && gain > 0));
  assert.ok(processor.sawBandGains.every((gain) => Number.isFinite(gain) && gain > 0));
  assert.ok(
    processor.sawBandGains.at(-1) > processor.sawBandGains[0] * 2,
    "the calibrated saw bank must compensate its high-frequency rolloff",
  );
});

test("the spelling vocoder renders bounded stereo-safe audio and handles voice/reset messages", () => {
  const Processor = loadWorklet().get("spelling-vocoder");
  const processor = new Processor();

  assert.equal(typeof processor.port.onmessage, "function");
  processor.port.onmessage({
    data: {
      type: "voice",
      frequency: 196,
      voicednessHint: 0.32,
      drive: 2.2,
      brightness: 0.82,
      clarity: 0.18,
    },
  });
  assert.equal(processor.targetFrequency, 196);
  assert.ok(Math.abs(processor.targetNoiseMix - 0.68) < 1e-12);
  assert.equal(processor.targetDrive, 2.2);
  assert.equal(processor.targetClarity, 0.18);
  assert.equal(processor.brightness, 0.82);
  assert.ok(
    processor.targetBandGains.at(-1) > processor.targetBandGains[0],
    "a bright voice message must tilt the synthesis bank upward",
  );

  const rendered = processSamples(processor, syntheticModulator());
  const metrics = signalMetrics(rendered);
  assert.ok(metrics.rms > 0.004, `the vocoded signal must be audible (RMS ${metrics.rms})`);
  assert.ok(metrics.peak > 0.018, `the vocoded signal must have a useful peak (${metrics.peak})`);
  assert.ok(Math.abs(processor.frequency - 196) < 0.5, "carrier pitch must follow voice messages");
  assert.ok(processor.envelopes.some((value) => value > 0));

  processor.port.onmessage({ data: { type: "reset" } });
  assert.equal(processor.phase, 0);
  assert.equal(processor.previousOutputInput, 0);
  assert.equal(processor.previousOutput, 0);
  assert.equal(processor.crossingRate, 0);
  assert.equal(processor.inputPower, 0);
  for (const state of [
    processor.envelopes,
    processor.envelopePowers,
    processor.modZ1,
    processor.modZ2,
    processor.sawZ1,
    processor.sawZ2,
    processor.noiseZ1,
    processor.noiseZ2,
  ]) assert.ok(state.every((value) => value === 0));

  const silence = new Float32Array(BLOCK_SIZE);
  const resetOutput = processSamples(processor, silence);
  assert.ok(resetOutput.every((sample) => sample === 0));
});

test("the signal detector follows voiced, unvoiced, and silent sections without a long tail", () => {
  const Processor = loadWorklet().get("spelling-vocoder");
  const processor = new Processor();
  processor.port.onmessage({
    data: {
      type: "voice",
      frequency: 132,
      unvoicedHint: 0.12,
      drive: 1.7,
      clarity: 0.14,
      brightness: 0.5,
    },
  });

  const sectionFrames = BLOCK_SIZE * 68;
  const voiced = new Float32Array(sectionFrames);
  for (let frame = 0; frame < voiced.length; frame += 1) {
    const phase = 2 * Math.PI * 132 * frame / SAMPLE_RATE;
    voiced[frame] = Math.sin(phase) * 0.28 + Math.sin(phase * 2) * 0.09;
  }
  processSamples(processor, voiced);
  const voicedProbability = processor.unvoicedProbability;

  let seed = 0x9e3779b9;
  const unvoiced = new Float32Array(sectionFrames);
  for (let frame = 0; frame < unvoiced.length; frame += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    unvoiced[frame] = (seed / 0x80000000 - 1) * 0.24;
  }
  const noisyOutput = processSamples(processor, unvoiced);
  const unvoicedProbability = processor.unvoicedProbability;
  assert.ok(voicedProbability < 0.22, `periodic input must remain voiced (${voicedProbability})`);
  assert.ok(unvoicedProbability > 0.68, `noise must select unvoiced excitation (${unvoicedProbability})`);
  assert.ok(unvoicedProbability > voicedProbability + 0.5);

  const silence = new Float32Array(BLOCK_SIZE * 48);
  const tail = processSamples(processor, silence);
  const noisyRms = signalMetrics(noisyOutput.slice(-BLOCK_SIZE * 8)).rms;
  const tailRms = signalMetrics(tail.slice(-BLOCK_SIZE * 8)).rms;
  assert.ok(
    tailRms < noisyRms * 0.1,
    `the 28 ms RMS-envelope release must shed at least 20 dB (${noisyRms} to ${tailRms})`,
  );

  processor.port.onmessage({ data: { type: "reset" } });
  assert.equal(processor.crossingRate, 0);
  assert.equal(processor.inputPower, 0);
  assert.equal(processor.previousDirectOutput, 0);
  assert.ok(processor.envelopePowers.every((value) => value === 0));
});

test("the real diphone atlas keeps its English spectral envelopes through the vocoder", () => {
  const Processor = loadWorklet().get("spelling-vocoder");
  const hints = {
    a: 0.04,
    e: 0.04,
    i: 0.04,
    o: 0.04,
    u: 0.04,
    l: 0.05,
    r: 0.05,
    s: 0.92,
    sh: 0.92,
    f: 0.92,
    x: 0.92,
    z: 0.38,
  };
  const correlations = [];
  for (const [key, unvoicedHint] of Object.entries(hints)) {
    const input = resampledAtlasClip(key);
    const processor = new Processor();
    processor.port.onmessage({
      data: {
        type: "voice",
        frequency: 132,
        unvoicedHint,
        drive: 1.9,
        clarity: 0.14,
        brightness: 0.5,
      },
    });
    const output = processSamples(processor, input);
    const inputBands = bankRms(input, processor);
    const outputBands = bankRms(output, processor);
    const correlation = logCorrelation(inputBands, outputBands);
    correlations.push(correlation);
    assert.ok(
      correlation >= (key === "f" ? 0.7 : 0.78),
      `${key.toUpperCase()} must retain its spectral envelope (correlation ${correlation})`,
    );
    if ("aeioulr".includes(key)) {
      const inflation = lowBandShare(outputBands) - lowBandShare(inputBands);
      assert.ok(
        inflation < 0.28,
        `${key.toUpperCase()} must not collapse into a low carrier tone (${inflation})`,
      );
    }
  }
  correlations.sort((first, second) => first - second);
  const median = correlations[Math.floor(correlations.length / 2)];
  assert.ok(median > 0.9, `median atlas spectral correlation must exceed 0.9 (${median})`);
});

test("the real-time process loop performs no explicit allocations", () => {
  const start = WORKLET_SOURCE.indexOf("  process(inputs, outputs) {");
  const end = WORKLET_SOURCE.indexOf("\n  }\n}\n\nregisterProcessor", start);
  assert.ok(start >= 0 && end > start);
  const processSource = WORKLET_SOURCE.slice(start, end);
  assert.doesNotMatch(processSource, /\bnew\s+(?:Array|Float\d+Array|Map|Set|Object)\b/);
});
