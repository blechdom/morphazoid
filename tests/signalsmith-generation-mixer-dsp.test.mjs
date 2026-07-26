import assert from "node:assert/strict";
import test from "node:test";

import { generationVoiceSpecs } from "../src/micmic.js";
import { SignalsmithGenerationMixerDSP } from "../src/signalsmith-generation-mixer-dsp.js";

test("fixed-pool mixer renders delayed taps without per-voice histories", () => {
  const renderer = new SignalsmithGenerationMixerDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxInputs: 3,
    maxVoices: 8,
  });
  renderer.setVoices([
    { key: "neutral", sourceIndex: 0, delay: 0.02, gain: 0.4, pan: -0.5 },
    { key: "shifted", sourceIndex: 1, delay: 0.04, gain: 0.3, pan: 0.5 },
  ]);
  let peak = 0;
  for (let block = 0; block < 8; block += 1) {
    const input = Float32Array.from({ length: 256 }, (_, index) => (
      Math.sin((block * 256 + index) * Math.PI / 17) * 0.2
    ));
    const shifted = Float32Array.from(input, (sample) => -sample);
    const left = new Float32Array(256);
    const right = new Float32Array(256);
    renderer.process([input, shifted], left, right);
    peak = Math.max(peak, ...left.map(Math.abs), ...right.map(Math.abs));
  }
  assert.ok(peak > 0.001);
  assert.equal(renderer.histories.length, 3);
  assert.equal(renderer.voices.size, 2);
});

test("mixer preserves the sixteenth shifted source beside its unison input", () => {
  const renderer = new SignalsmithGenerationMixerDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxInputs: 17,
    maxVoices: 4,
  });
  renderer.setVoices([
    { key: "sixteenth-shift", sourceIndex: 16, delay: 0.02, gain: 0.5, pan: 0 },
  ]);

  assert.equal(renderer.maxInputs, 17);
  assert.equal(renderer.histories.length, 17);
  assert.equal(renderer.voices.get("sixteenth-shift").target.sourceIndex, 16);

  let peak = 0;
  for (let block = 0; block < 4; block += 1) {
    const inputs = Array.from({ length: 17 }, () => new Float32Array(256));
    inputs[16].fill(0.25);
    const left = new Float32Array(256);
    const right = new Float32Array(256);
    renderer.process(inputs, left, right);
    peak = Math.max(peak, ...left.map(Math.abs), ...right.map(Math.abs));
  }
  assert.ok(peak > 0.01, "source index 16 must remain independently audible");
});

test("mixer crossfades stationary read positions when timing or pitch slot changes", () => {
  const renderer = new SignalsmithGenerationMixerDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxInputs: 3,
    maxVoices: 4,
  });
  renderer.setVoices([
    { key: "branch", sourceIndex: 1, delay: 0.2, gain: 0.5, pan: 0 },
  ]);
  renderer.setVoices([
    { key: "branch", sourceIndex: 2, delay: 0.8, gain: 0.5, pan: 0 },
  ]);
  const voice = renderer.voices.get("branch");
  assert.deepEqual(voice.delayValues, [0.2, 0.8]);
  assert.equal(voice.previousSourceIndex, 1);
  assert.equal(voice.target.sourceIndex, 2);
  assert.equal(voice.delayFade, 0);

  const silence = new Float32Array(512);
  renderer.process([silence, silence, silence], new Float32Array(512), new Float32Array(512));
  assert.ok(voice.delayFade > 0 && voice.delayFade < 1);
});

test("mixer follows a changing runtime branch ceiling inside its hard guard", () => {
  const renderer = new SignalsmithGenerationMixerDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxInputs: 2,
    maxVoices: 64,
  });
  const voices = Array.from({ length: 64 }, (_, index) => ({
    key: `branch:${index}`,
    sourceIndex: index % 2,
    delay: 0.02 + index / 10_000,
    gain: 0.01,
    pan: 0,
  }));
  renderer.setVoices(voices, 32);
  assert.equal(renderer.runtimeLimit, 32);
  assert.equal(renderer.activeTargetCount, 32);
  assert.equal(renderer.voices.size, 32);

  renderer.setVoices(voices, 64);
  assert.equal(renderer.runtimeLimit, 64);
  assert.equal(renderer.activeTargetCount, 64);
  assert.equal(renderer.voices.size, 64);
});

test("mixer can expose hundreds of virtual read heads to device calibration", () => {
  const renderer = new SignalsmithGenerationMixerDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxInputs: 2,
    maxVoices: 512,
  });
  const voices = Array.from({ length: 512 }, (_, index) => ({
    key: `branch:${index}`,
    sourceIndex: index % 2,
    delay: 0.02 + index / 100_000,
    gain: 0.001,
    pan: 0,
  }));
  renderer.setVoices(voices, 512);
  assert.equal(renderer.maxVoices, 512);
  assert.equal(renderer.runtimeLimit, 512);
  assert.equal(renderer.activeTargetCount, 512);
  assert.equal(renderer.voices.size, 512);
});

test("small pruning changes crossfade every outgoing virtual read head", () => {
  const renderer = new SignalsmithGenerationMixerDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxInputs: 2,
    maxVoices: 128,
  });
  const voices = (prefix) => Array.from({ length: 48 }, (_, index) => ({
    key: `${prefix}:${index}`,
    sourceIndex: index % 2,
    delay: 0.02,
    gain: 0.01,
    pan: 0,
  }));
  renderer.setVoices(voices("depth"), 48);
  renderer.setVoices(voices("breadth"), 48);
  assert.equal(renderer.activeTargetCount, 48);
  assert.equal(renderer.voices.size, 96);
  assert.equal(
    [...renderer.voices.values()].filter((voice) => voice.releasing).length,
    48,
  );
});

test("a large breadth-to-depth pruning jump releases every replaced branch", () => {
  const renderer = new SignalsmithGenerationMixerDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxInputs: 2,
    maxVoices: 1024,
  });
  const plan = (pruningBias) => generationVoiceSpecs({
    generations: 12,
    branching: 1,
    timeRatio: 0.72,
    angle: 45,
    pruningBias,
    maximumVoices: 256,
  }).map((voice) => ({
    ...voice,
    sourceIndex: 0,
  }));
  renderer.setVoices(plan(0), 256);
  renderer.setVoices(plan(1), 256);

  const releasing = [...renderer.voices.values()]
    .filter((voice) => voice.releasing);
  assert.equal(releasing.length, 153);
  assert.equal(renderer.voices.size, 409);
});

test("an emergency nested ceiling reduction fades the complete prior pool", () => {
  const renderer = new SignalsmithGenerationMixerDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxInputs: 2,
    maxVoices: 1024,
  });
  const voices = Array.from({ length: 512 }, (_, index) => ({
    key: `branch:${index}`,
    sourceIndex: 0,
    delay: 0.02,
    gain: 0.001,
    pan: 0,
  }));
  renderer.setVoices(voices, 512);
  renderer.setVoices(voices, 48);

  assert.equal(renderer.activeTargetCount, 48);
  assert.equal(renderer.voices.size, 512);
  assert.equal(
    [...renderer.voices.values()].filter((voice) => voice.releasing).length,
    464,
  );
});
