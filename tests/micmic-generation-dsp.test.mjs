import assert from "node:assert/strict";
import test from "node:test";
import { MicmicGenerationDSP } from "../src/micmic-generation-dsp.js";

test("generation DSP renders delayed pitchable taps from one rolling microphone", () => {
  const renderer = new MicmicGenerationDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxVoices: 8,
  });
  renderer.setVoices([
    { key: "g1", delay: 0.2, rate: 1, gain: 0.3, pan: -0.5 },
    { key: "g2", delay: 0.4, rate: 1.5, gain: 0.2, pan: 0.5 },
  ]);
  assert.equal(renderer.grainLength(renderer.voices.get("g1")), renderer.maximumGrainSamples);
  assert.equal(renderer.grainLength(renderer.voices.get("g2")), renderer.maximumGrainSamples);
  let peak = 0;
  for (let block = 0; block < 12; block += 1) {
    const input = Float32Array.from({ length: 512 }, (_, index) => (
      Math.sin((block * 512 + index) * Math.PI / 23) * 0.2
    ));
    const left = new Float32Array(512);
    const right = new Float32Array(512);
    assert.equal(renderer.process(input, null, left, right), true);
    peak = Math.max(peak, ...left.map(Math.abs), ...right.map(Math.abs));
  }
  assert.ok(peak > 0.001);
  assert.ok(peak <= 1);
  assert.equal(renderer.voices.size, 2);
});

test("neutral pitch uses an exact ten-sample delay without granular resynthesis", () => {
  const renderer = new MicmicGenerationDSP({ sampleRate: 8_000, historySeconds: 4, maxVoices: 2 });
  renderer.setVoices([{ key: "clean", delay: 10 / 8_000, rate: 1, gain: 0.5, pan: 0 }]);
  const initialPhase = renderer.voices.get("clean").phase;
  let peak = 0;
  for (let block = 0; block < 10; block += 1) {
    const input = Float32Array.from({ length: 128 }, (_, index) => ((block * 128 + index) % 19) / 50 - 0.18);
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    renderer.process(input, null, left, right);
    peak = Math.max(peak, ...left.map(Math.abs), ...right.map(Math.abs));
  }
  assert.ok(peak > 0.001);
  assert.equal(renderer.voices.get("clean").target.delay, 10 / 8_000);
  assert.equal(renderer.voices.get("clean").phase, initialPhase, "the neutral path must bypass grain phasors");
});

test("fallback delay targets cannot exceed their allocated history", () => {
  const renderer = new MicmicGenerationDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxVoices: 2,
  });
  renderer.setVoices([
    { key: "bounded", delay: 58, rate: 1, gain: 0.5, pan: 0 },
  ]);
  assert.equal(
    renderer.voices.get("bounded").target.delay,
    renderer.maximumDelay,
  );
  assert.ok(renderer.maximumDelay < 4);
});

test("retiming a fallback voice crossfades two fixed read positions", () => {
  const renderer = new MicmicGenerationDSP({ sampleRate: 8_000, historySeconds: 4, maxVoices: 2 });
  renderer.setVoices([{ key: "clean", delay: 0.2, rate: 1, gain: 0.5, pan: 0 }]);
  renderer.setVoices([{ key: "clean", delay: 0.8, rate: 1, gain: 0.5, pan: 0 }]);
  const voice = renderer.voices.get("clean");

  assert.deepEqual(voice.delayValues, [0.2, 0.8]);
  assert.equal(voice.delayFrom, 0);
  assert.equal(voice.delayTo, 1);
  assert.equal(voice.delayFade, 0);

  const silence = new Float32Array(512);
  renderer.process(silence, silence, new Float32Array(512), new Float32Array(512));
  assert.ok(voice.delayFade > 0 && voice.delayFade < 1);
  assert.deepEqual(voice.delayValues, [0.2, 0.8], "neither read position should glide");
});

test("pitch gestures retune one raw-history read head instead of reusing pitched history", () => {
  const renderer = new MicmicGenerationDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxVoices: 2,
  });
  const rawHistory = renderer.history;
  renderer.setVoices([
    { key: "branch", delay: 0.2, rate: 2, gain: 0.5, pan: 0 },
  ]);
  renderer.setVoices([
    { key: "branch", delay: 0.2, rate: 0.5, gain: 0.5, pan: 0 },
  ]);
  const voice = renderer.voices.get("branch");

  assert.equal(renderer.history, rawHistory);
  assert.equal(voice.rate, 2);
  assert.equal(voice.target.rate, 0.5);
  renderer.process(
    new Float32Array([0.1]),
    null,
    new Float32Array(1),
    new Float32Array(1),
  );
  assert.ok(voice.rate < 2 && voice.rate > 0.5, "pitch must glide on the raw read head");
});

test("fallback generation DSP obeys the adaptive runtime ceiling", () => {
  const renderer = new MicmicGenerationDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxVoices: 64,
  });
  const voices = Array.from({ length: 64 }, (_, index) => ({
    key: `voice:${index}`,
    delay: 0.02,
    rate: 1,
    gain: 0.01,
    pan: 0,
  }));
  renderer.setVoices(voices, 32);
  assert.equal(renderer.runtimeLimit, 32);
  assert.equal(renderer.activeTargetCount, 32);
  renderer.setVoices(voices, 64);
  assert.equal(renderer.runtimeLimit, 64);
  assert.equal(renderer.activeTargetCount, 64);
});

test("fallback generation DSP permits a large calibrated virtual branch pool", () => {
  const renderer = new MicmicGenerationDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxVoices: 512,
  });
  const voices = Array.from({ length: 512 }, (_, index) => ({
    key: `voice:${index}`,
    delay: 0.02,
    rate: 1,
    gain: 0.001,
    pan: 0,
  }));
  renderer.setVoices(voices, 512);
  assert.equal(renderer.maxVoices, 512);
  assert.equal(renderer.runtimeLimit, 512);
  assert.equal(renderer.activeTargetCount, 512);
});

test("fallback pruning changes crossfade a complete small outgoing canopy", () => {
  const renderer = new MicmicGenerationDSP({
    sampleRate: 8_000,
    historySeconds: 4,
    maxVoices: 128,
  });
  const voices = (prefix) => Array.from({ length: 48 }, (_, index) => ({
    key: `${prefix}:${index}`,
    delay: 0.02,
    rate: 1,
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
