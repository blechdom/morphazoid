import assert from "node:assert/strict";
import test from "node:test";

import {
  chaoticVisualRegions,
  createChaoticSpectrogram,
  normalizeChaoticWaveformSample,
  updateChaoticSpectrogram,
} from "../src/chaotic-synth-visuals.js";

test("chaotic synth analysis reserves scope above spectrogram and flow", () => {
  for (const height of [380, 500, 800]) {
    const regions = chaoticVisualRegions(1_000, height);
    assert.ok(regions.scopeTop >= 108);
    assert.ok(regions.scopeBottom > regions.scopeTop);
    assert.ok(regions.spectrogramTop > regions.scopeBottom);
    assert.ok(regions.spectrogramBottom > regions.spectrogramTop);
    assert.ok(regions.spectrogramBottom < height * 0.7);
  }
});

test("scope normalization accepts byte and float analyser data", () => {
  assert.equal(normalizeChaoticWaveformSample(new Uint8Array([0]), 0), -1);
  assert.equal(normalizeChaoticWaveformSample(new Uint8Array([128]), 0), 0);
  assert.ok(
    Math.abs(
      normalizeChaoticWaveformSample(new Uint8Array([255]), 0) - 0.9921875,
    ) < 1e-12,
  );
  assert.equal(normalizeChaoticWaveformSample(new Float32Array([0.75]), 0), 0.75);
  assert.equal(normalizeChaoticWaveformSample(new Float32Array([2]), 0), 1);
});

test("spectrogram updates one efficient history column from an analyser", () => {
  const calls = [];
  const context = {
    fillStyle: "",
    drawImage(...args) { calls.push(["drawImage", ...args]); },
    fillRect(...args) { calls.push(["fillRect", ...args]); },
  };
  const documentObject = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() { return context; },
      };
    },
  };
  const analyser = {
    context: { sampleRate: 48_000 },
    frequencyBinCount: 64,
    getByteFrequencyData(target) {
      target.fill(96);
      target[8] = 255;
    },
  };
  const state = createChaoticSpectrogram(documentObject, {
    width: 32,
    height: 16,
  });

  assert.equal(updateChaoticSpectrogram(state, analyser, { hue: 320 }), true);
  assert.equal(state.frames, 1);
  assert.equal(state.frequencyData.length, 64);
  assert.equal(calls.some(([name]) => name === "drawImage"), true);
  assert.ok(
    calls.filter(([name]) => name === "fillRect").length >= state.canvas.height,
  );
});
