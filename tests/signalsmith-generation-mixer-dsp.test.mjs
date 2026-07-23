import assert from "node:assert/strict";
import test from "node:test";

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
