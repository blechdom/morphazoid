import assert from "node:assert/strict";
import test from "node:test";

import {
  chaoticLiveVisualRegions,
  chaoticSpectrumBin,
  chaoticVisualRegions,
  createChaoticSpectrum,
  createChaoticSpectrogram,
  drawChaoticLiveAnalysis,
  drawChaoticSpectrum,
  normalizeChaoticWaveformSample,
  updateChaoticSpectrum,
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

test("live analysis layers the oscilloscope over the spectrum in one region", () => {
  for (const height of [380, 500, 800]) {
    const regions = chaoticLiveVisualRegions(1_000, height);
    assert.ok(regions.spectrumTop >= 104);
    assert.ok(regions.spectrumBottom > regions.spectrumTop);
    assert.equal(regions.scopeTop, regions.spectrumTop);
    assert.equal(regions.scopeBottom, regions.spectrumBottom);
    assert.ok(regions.scopeBottom < height * 0.7);
  }
});

test("live spectrum reads current dB bins without accumulating history", () => {
  const analyser = {
    context: { sampleRate: 48_000 },
    frequencyBinCount: 1_024,
    minDecibels: -90,
    maxDecibels: 0,
    getFloatFrequencyData(target) {
      target.fill(-90);
      target[chaoticSpectrumBin(1_000, target.length, 48_000)] = -12;
    },
  };
  const state = createChaoticSpectrum();
  assert.equal(updateChaoticSpectrum(state, analyser), true);
  assert.equal(state.frames, 1);
  assert.equal(state.frequencyData.length, 1_024);
  assert.equal(
    state.displayData[chaoticSpectrumBin(1_000, 1_024, 48_000)],
    -12,
  );

  analyser.getFloatFrequencyData = (target) => target.fill(-90);
  updateChaoticSpectrum(state, analyser, { releaseDecibelsPerFrame: 4 });
  assert.equal(state.frames, 2);
  assert.equal(
    state.displayData[chaoticSpectrumBin(1_000, 1_024, 48_000)],
    -16,
    "display release may smooth a frame but must not scroll or retain history columns",
  );
});

test("live spectrum maps low-to-high frequency logarithmically as discrete bars", () => {
  assert.equal(chaoticSpectrumBin(0, 1_024, 48_000), 0);
  assert.equal(chaoticSpectrumBin(24_000, 1_024, 48_000), 1_023);
  assert.ok(chaoticSpectrumBin(2_000, 1_024, 48_000) > chaoticSpectrumBin(200, 1_024, 48_000));

  const calls = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, stroke() {}, fill() {},
    moveTo(...args) { calls.push(["moveTo", ...args]); },
    lineTo(...args) { calls.push(["lineTo", ...args]); },
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    strokeRect(...args) { calls.push(["strokeRect", ...args]); },
    fillText(...args) { calls.push(["fillText", ...args]); },
  };
  const state = createChaoticSpectrum();
  state.displayData = new Float32Array(1_024).fill(-42);
  state.frames = 1;
  const regions = chaoticLiveVisualRegions(900, 500);
  drawChaoticSpectrum(context, state, regions);
  assert.ok(calls.some(
    ([name, text]) => name === "fillText"
      && text === "LIVE SPECTRUM · HZ / WAVEFORM OVERLAY",
  ));
  assert.ok(calls.some(([name, text]) => name === "fillText" && text === "-90"));
  assert.ok(calls.filter(([name]) => name === "fillRect").length > 64);
  assert.ok(
    calls.filter(([name]) => name === "lineTo").length < 20,
    "the spectrum must not draw a connected terrain silhouette",
  );
});

test("each live spectrum bar preserves a narrow peak anywhere in its frequency band", () => {
  const calls = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, stroke() {},
    moveTo() {}, lineTo() {}, strokeRect() {}, fillText() {},
    fillRect(...args) { calls.push(args); },
  };
  const state = createChaoticSpectrum();
  const regions = chaoticLiveVisualRegions(900, 500);
  const plotWidth = regions.right - regions.left;
  const plotHeight = regions.spectrumBottom - regions.spectrumTop;
  const barCount = Math.round(Math.min(80, Math.max(32, Math.floor(plotWidth / 11))));
  const peakBand = barCount - 6;
  const logRange = Math.log(20_000 / 20);
  const bandLow = 20 * Math.exp(logRange * peakBand / barCount);
  const bandHigh = 20 * Math.exp(logRange * (peakBand + 1) / barCount);
  const firstBin = chaoticSpectrumBin(bandLow, 1_024, 48_000);
  const lastBin = chaoticSpectrumBin(bandHigh, 1_024, 48_000);

  state.displayData = new Float32Array(1_024).fill(-90);
  state.displayData[Math.min(lastBin, firstBin + 1)] = -6;
  state.frames = 1;
  drawChaoticSpectrum(context, state, regions);

  assert.ok(lastBin - firstBin > 2, "fixture must place the peak away from the band center");
  assert.ok(
    calls.slice(1).some(([, , , height]) => height > plotHeight * 0.9),
    "max aggregation must turn the narrow peak into a tall rectangular bar",
  );
});

test("live analysis paints every spectrum bar before the foreground waveform", () => {
  const calls = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, stroke() {}, fill() {},
    moveTo(...args) { calls.push(["moveTo", ...args]); },
    lineTo(...args) { calls.push(["lineTo", ...args]); },
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    strokeRect(...args) { calls.push(["strokeRect", ...args]); },
    fillText(...args) { calls.push(["fillText", ...args]); },
  };
  const analyser = {
    context: { sampleRate: 48_000 },
    frequencyBinCount: 1_024,
    minDecibels: -90,
    maxDecibels: 0,
    getFloatFrequencyData(target) { target.fill(-24); },
  };
  drawChaoticLiveAnalysis(context, {
    analyser,
    audioOn: true,
    height: 500,
    spectrum: createChaoticSpectrum(),
    waveform: new Float32Array([0, 0.75, -0.75, 0]),
    width: 900,
  });
  const lastBar = calls.findLastIndex(([name]) => name === "fillRect");
  const lastWaveformSegment = calls.findLastIndex(([name]) => name === "lineTo");
  assert.ok(lastBar >= 0);
  assert.ok(lastWaveformSegment > lastBar);
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
