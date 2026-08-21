import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  JAW_HARP_DEFAULTS,
  JAW_HARP_PRESETS,
  VOWEL_PRESETS,
  applyVowel,
  breathCycleFlow,
  breathCycleIntervalMs,
  dominantHarmonic,
  jawHarpState,
  mouthFormants,
  mouthGeometry,
  randomizeJawHarpState,
  reedModeFrequencies,
  repeatIntervalMs,
  sanitizeJawHarpState,
} from "../src/jaw-harp.js";

const root = new URL("../", import.meta.url);

test("jaw-harp presets describe distinct physical reeds", () => {
  assert.equal(JAW_HARP_PRESETS.length, 5);
  assert.equal(new Set(JAW_HARP_PRESETS.map(({ id }) => id)).size, 5);
  assert.equal(new Set(JAW_HARP_PRESETS.map(({ settings }) => settings.reedFrequencyHz)).size, 5);
  for (const preset of JAW_HARP_PRESETS) {
    const state = jawHarpState(preset.id);
    assert.equal(state.presetId, preset.id);
    assert.ok(state.reedFrequencyHz >= 38 && state.reedFrequencyHz <= 180);
    assert.ok(state.reedDecaySeconds >= 0.35 && state.reedDecaySeconds <= 8);
  }
});

test("vowel postures move formants without moving the reed fundamental", () => {
  const starting = jawHarpState("khomus");
  const results = VOWEL_PRESETS.map(({ id }) => applyVowel(starting, id));
  assert.deepEqual(results.map(({ reedFrequencyHz }) => reedFrequencyHz), Array(5).fill(74));
  assert.equal(new Set(results.map((state) => Math.round(mouthFormants(state).focusFrequencyHz))).size, 5);
  assert.ok(dominantHarmonic(results[2]).index > dominantHarmonic(results[4]).index);
});

test("mouth geometry and formants remain physical and ordered", () => {
  for (const vowel of VOWEL_PRESETS) {
    const state = applyVowel(JAW_HARP_DEFAULTS, vowel.id);
    const geometry = mouthGeometry(state);
    const formants = mouthFormants(state);
    assert.ok(geometry.lengthM >= 0.085 && geometry.lengthM <= 0.235);
    assert.ok(geometry.volumeMl >= 24 && geometry.volumeMl <= 170);
    assert.ok(formants.frequenciesHz[0] < formants.frequenciesHz[1]);
    assert.ok(formants.frequenciesHz[1] < formants.frequenciesHz[2]);
  }
});

test("reed modes form a slightly stretched harmonic ladder", () => {
  const state = jawHarpState("munnharpe");
  const modes = reedModeFrequencies(state, 24);
  assert.equal(modes.length, 24);
  assert.ok(modes.every((frequency, index) => index === 0 || frequency > modes[index - 1]));
  assert.ok(modes[23] > modes[0] * 24);
});

test("state sanitization and deterministic randomization stay bounded", () => {
  const unsafe = sanitizeJawHarpState({
    reedFrequencyHz: Infinity,
    tonguePosition: -4,
    tongueHeight: 9,
    repeatRateBpm: 9999,
    pluckDirection: -7,
  });
  assert.equal(unsafe.tonguePosition, 0);
  assert.equal(unsafe.tongueHeight, 1);
  assert.equal(unsafe.repeatRateBpm, 480);
  assert.equal(unsafe.pluckDirection, -1);
  const randomized = randomizeJawHarpState(JAW_HARP_DEFAULTS, () => 0.5);
  assert.equal(randomized.reedFrequencyHz, 92);
  assert.equal(randomized.tonguePosition, 0.5);
  assert.ok(randomized.cavityCoupling >= 0 && randomized.cavityCoupling <= 1);
});

test("swing preserves each two-pluck pair duration", () => {
  const straight = repeatIntervalMs(120, 0, 0);
  const long = repeatIntervalMs(120, 0, 0.3);
  const short = repeatIntervalMs(120, 1, 0.3);
  assert.equal(straight, 500);
  assert.ok(long > straight);
  assert.ok(short < straight);
  assert.ok(Math.abs(long + short - straight * 2) < 1e-9);
});

test("automatic breath is a bounded signed inhale-exhale cycle", () => {
  const state = sanitizeJawHarpState({
    ...JAW_HARP_DEFAULTS,
    breathDepth: 0.8,
    breathBalance: 0.4,
    breathRateBpm: 30,
  });
  assert.equal(breathCycleIntervalMs(state.breathRateBpm), 2_000);
  assert.ok(breathCycleFlow(state, 0.2) < -0.79);
  assert.ok(breathCycleFlow(state, 0.7) > 0.79);
  assert.ok(Math.abs(breathCycleFlow(state, 0)) < 1e-12);
  assert.ok(Math.abs(breathCycleFlow(state, 1)) < 1e-12);
  assert.ok(Math.abs(breathCycleFlow(state, -0.3)) <= state.breathDepth);
});

test("jaw-harp worklet renders a bounded, decaying pluck", async () => {
  const previousRate = globalThis.sampleRate;
  const previousBase = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  let Processor;
  let telemetry;
  globalThis.sampleRate = 48_000;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, postMessage: (message) => { telemetry = message; } };
    }
  };
  globalThis.registerProcessor = (name, Constructor) => {
    assert.equal(name, "jaw-harp-physical-model");
    Processor = Constructor;
  };
  try {
    await import(`../src/jaw-harp-processor.js?test=${Date.now()}`);
    const processor = new Processor({ processorOptions: { configuration: JAW_HARP_DEFAULTS } });
    processor._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
    let squareSum = 0;
    let peak = 0;
    for (let block = 0; block < 200; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      for (const sample of left) {
        squareSum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    const rms = Math.sqrt(squareSum / (200 * 128));
    assert.ok(rms > 0.01 && rms < 0.4);
    assert.ok(peak > 0.05 && peak < 0.95);
    assert.equal(telemetry.type, "telemetry");
    assert.ok(telemetry.energy > 0);

    const renderBreath = (flow) => {
      const voiced = new Processor({ processorOptions: { configuration: JAW_HARP_DEFAULTS } });
      voiced._handleMessage({ type: "pluck", force: 0.72, direction: 1, position: 0.32 });
      voiced._handleMessage({ type: "breath", flow });
      let lateSquareSum = 0;
      let lateSamples = 0;
      let latePeak = 0;
      for (let block = 0; block < 700; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        voiced.process([], [[left, right]]);
        if (block < 500) continue;
        for (const sample of left) {
          lateSquareSum += sample * sample;
          latePeak = Math.max(latePeak, Math.abs(sample));
          lateSamples += 1;
        }
      }
      return { rms: Math.sqrt(lateSquareSum / lateSamples), peak: latePeak };
    };
    const unbreathed = renderBreath(0);
    const inhaled = renderBreath(-0.78);
    const exhaled = renderBreath(0.78);
    assert.ok(inhaled.rms > unbreathed.rms * 1.05);
    assert.ok(exhaled.rms > unbreathed.rms * 1.05);
    assert.ok(Math.abs(exhaled.rms - inhaled.rms) > 0.001);
    assert.ok(inhaled.peak < 0.98 && exhaled.peak < 0.98);
  } finally {
    globalThis.sampleRate = previousRate;
    globalThis.AudioWorkletProcessor = previousBase;
    globalThis.registerProcessor = previousRegister;
  }
});

test("jaw-harp page exposes the physical model and accessible interactions", async () => {
  const [html, css, app, processor] = await Promise.all([
    readFile(new URL("jaw-harp.html", root), "utf8"),
    readFile(new URL("jaw-harp.css", root), "utf8"),
    readFile(new URL("jaw-harp-app.js", root), "utf8"),
    readFile(new URL("src/jaw-harp-processor.js", root), "utf8"),
  ]);
  assert.match(html, /<body class="jaw-harp-page"/);
  assert.match(html, /id="stage"[\s\S]*?tabindex="0"/);
  assert.match(html, /id="pluckButton"[\s\S]*?data-primary-transport/);
  assert.match(html, /id="tonguePosition"/);
  assert.match(html, /id="jawOpening"/);
  assert.match(html, /id="cavityCoupling"/);
  assert.match(html, /id="inhaleButton"/);
  assert.match(html, /id="exhaleButton"/);
  assert.match(html, /id="breathCycleButton"/);
  assert.match(html, /src="jaw-harp-app\.js"/);
  assert.match(css, /\.jaw-harp-page \.shell/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(app, /new AudioWorkletNode\(context, "jaw-harp-physical-model"/);
  assert.match(app, /pointerdown/);
  assert.match(processor, /registerProcessor\("jaw-harp-physical-model"/);
  assert.match(processor, /class StateVariableBandpass/);
  assert.match(processor, /message\.type === "breath"/);
});
