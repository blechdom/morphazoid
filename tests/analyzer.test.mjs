import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  clamp,
  computeRms,
  createAnalysisGraph,
  dbToUnit,
  estimatePeakFrequency,
  formatFrequency,
  frameIsDue,
  frequencyBin,
  frequencyToLogPosition,
  logPositionToFrequency,
  makeSoftClipCurve,
  normalizeFftSize,
  peakAbsolute,
  spectrogramRgb,
  spectrumLogSamples,
} from "../src/analyzer.js";

const root = new URL("../", import.meta.url);

test("log-frequency mapping is bounded and reversible", () => {
  assert.equal(frequencyToLogPosition(20, 20, 20_000), 0);
  assert.equal(frequencyToLogPosition(20_000, 20, 20_000), 1);
  assert.equal(frequencyToLogPosition(1, 20, 20_000), 0);
  assert.equal(frequencyToLogPosition(40_000, 20, 20_000), 1);
  for (const frequency of [20, 50, 100, 440, 1_000, 8_000, 20_000]) {
    const roundTrip = logPositionToFrequency(
      frequencyToLogPosition(frequency, 20, 20_000),
      20,
      20_000,
    );
    assert.ok(Math.abs(roundTrip - frequency) < 1e-8 * frequency);
  }
});

test("spectrum samples advance logarithmically through FFT bins", () => {
  const bins = Float32Array.from({ length: 2_048 }, (_, index) => -100 + (index / 40));
  const values = spectrumLogSamples(bins, {
    sampleRate: 48_000,
    fftSize: 4_096,
    columns: 4,
    minimumFrequency: 20,
    maximumFrequency: 20_000,
  });
  assert.equal(values.length, 4);
  assert.ok(values[0] < values[1]);
  assert.ok(values[1] < values[2]);
  assert.ok(values[2] < values[3]);
  assert.equal(frequencyBin(1_000, 48_000, 4_096), 85);
});

test("signal measurements stay finite and find an FFT peak", () => {
  const waveform = Float32Array.from([0.5, -0.5, 0.5, -0.5]);
  assert.equal(computeRms(waveform), 0.5);
  assert.equal(peakAbsolute(waveform), 0.5);
  assert.equal(computeRms([]), 0);
  assert.equal(peakAbsolute([Number.NaN, -0.8]), 0.8);

  const bins = new Float32Array(2_048);
  bins.fill(-100);
  bins[85] = -20;
  bins[84] = -30;
  bins[86] = -30;
  const peak = estimatePeakFrequency(bins, 48_000, 4_096);
  assert.ok(Math.abs(peak - 996.09375) < 0.001);
});

test("display normalization, palette, formatting, and frame throttle are bounded", () => {
  assert.equal(clamp(Number.NaN, 0, 1), 0);
  assert.equal(dbToUnit(-100, -100, -20), 0);
  assert.equal(dbToUnit(-60, -100, -20), 0.5);
  assert.equal(dbToUnit(-20, -100, -20), 1);
  assert.deepEqual(spectrogramRgb(0), [4, 7, 11]);
  assert.deepEqual(spectrogramRgb(1), [255, 248, 218]);
  assert.equal(formatFrequency(220), "220 Hz");
  assert.equal(formatFrequency(2_200), "2.20 kHz");
  assert.equal(normalizeFftSize(3_900), 4_096);
  assert.equal(frameIsDue(10, -Infinity, 30), true);
  assert.equal(frameIsDue(20, 10, 30), false);
  assert.equal(frameIsDue(44, 10, 30), true);
});

test("soft ceiling curve is symmetric and never exceeds its ceiling", () => {
  const curve = makeSoftClipCurve(1_024, 1.15, 0.92);
  assert.equal(curve.length, 1_024);
  assert.ok(Math.abs(curve[0] + 0.92) < 1e-6);
  assert.ok(Math.abs(curve.at(-1) - 0.92) < 1e-6);
  for (let index = 0; index < curve.length; index += 1) {
    assert.ok(Math.abs(curve[index]) <= 0.920001);
    assert.ok(Math.abs(curve[index] + curve[curve.length - 1 - index]) < 1e-6);
  }
});

test("analysis graph has one safely limited master path before its analyzer", () => {
  function param(initial = 0) {
    return {
      value: initial,
      setValueAtTime(value) { this.value = value; },
      setTargetAtTime(value) { this.value = value; },
    };
  }
  function node(name, extra = {}) {
    return {
      name,
      connections: [],
      disconnected: false,
      connect(destination) {
        this.connections.push(destination);
        return destination;
      },
      disconnect() { this.disconnected = true; },
      ...extra,
    };
  }

  const destination = node("destination");
  const context = {
    currentTime: 0,
    destination,
    createGain() { return node("gain", { gain: param() }); },
    createBiquadFilter() {
      return node("filter", { frequency: param(), Q: param(), type: "" });
    },
    createDynamicsCompressor() {
      return node("compressor", {
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
      });
    },
    createWaveShaper() { return node("ceiling", { curve: null, oversample: "none" }); },
    createAnalyser() {
      return node("analyser", {
        fftSize: 2_048,
        minDecibels: -100,
        maxDecibels: -18,
        smoothingTimeConstant: 0,
      });
    },
  };

  const graph = createAnalysisGraph(context, { level: 0.42, fftSize: 4_096 });
  assert.equal(graph.master.gain.value, 0.42);
  assert.equal(graph.limiter.threshold.value, -10);
  assert.equal(graph.limiter.ratio.value, 20);
  assert.equal(graph.ceiling.curve.length, 2_048);
  assert.equal(graph.analyser.fftSize, 4_096);
  assert.equal(graph.monitor.gain.value, 0);
  assert.equal(graph.input.connections[0], graph.master);
  assert.equal(graph.master.connections[0], graph.highpass);
  assert.equal(graph.highpass.connections[0], graph.limiter);
  assert.equal(graph.limiter.connections[0], graph.ceiling);
  assert.equal(graph.ceiling.connections[0], graph.analyser);
  assert.equal(graph.analyser.connections[0], graph.monitor);
  assert.equal(graph.monitor.connections[0], destination);
  graph.setMonitoring(true);
  assert.equal(graph.monitor.gain.value, 1);
  graph.setLevel(0.6);
  assert.equal(graph.master.gain.value, 0.6);
  graph.disconnect();
  assert.equal(graph.input.disconnected, true);
  assert.equal(graph.ceiling.curve, null);
});

test("Analyzer is an internal Morphazoid page with accessible audio and displays", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("analyzer.html", root), "utf8"),
    readFile(new URL("analyzer-app.js", root), "utf8"),
    readFile(new URL("analyzer.css", root), "utf8"),
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="analyzer-app\.js"><\/script>/);
  assert.match(html, /class="tab analyzer-tab active"[^>]*aria-current="page"/);
  assert.match(html, /id="audioButton"[\s\S]*?<b>Audio<\/b><small id="audioState">off<\/small>/);
  assert.match(html, /for="masterLevel"[\s\S]*?<b>Master<\/b>/);
  assert.match(html, /id="sourceTone"[^>]*checked/);
  assert.match(html, /id="sourceMicrophone"/);
  assert.match(html, /id="oscilloscope"[\s\S]*?role="img"/);
  assert.match(html, /id="spectrum"[\s\S]*?role="img"/);
  assert.match(html, /id="spectrogram"[\s\S]*?role="img"/);
  assert.doesNotMatch(html, /\bhref="https?:\/\//);

  assert.match(app, /createAnalysisGraph\(audioContext/);
  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(app, /analysisGraph\.analyser\.getFloatFrequencyData/);
  assert.match(app, /drawImage\(\s*ui\.spectrogram/);
  assert.match(app, /frameIsDue\(timestamp, lastDisplayFrame, DISPLAY_FPS\)/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /pagehide/);
  assert.match(app, /track\.stop\(\)/);
  assert.match(css, /\.spectrogram-card/);
  assert.match(css, /@media \(max-width: 900px\)/);
});
